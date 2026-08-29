import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../../src/database/prisma.service';
import { NotificationConsumer } from '../../src/notifications/notification.consumer';
import { MAX_ATTEMPTS, OutboxProcessor } from '../../src/outbox/outbox.processor';
import { type IntegrationApp, startIntegrationApp } from './support/integration-app';

/**
 * Transactional outbox + in-app notification proofs (AC-7 and
 * IMPLEMENTATION_GUIDE.md §6). The central guarantee under test: the worker is
 * downstream of the money. A transfer commits with its event; the worker turns
 * events into notifications later, at-least-once, without ever being able to
 * alter what already committed.
 */
describe('Outbox worker and notifications (integration)', () => {
  let harness: IntegrationApp;
  let app: INestApplication;
  let prisma: PrismaService;
  let processor: OutboxProcessor;

  interface TestUser {
    id: string;
    cookie: string;
    csrfToken: string;
  }

  beforeAll(async () => {
    harness = await startIntegrationApp();
    app = harness.app;
    prisma = harness.prisma;
    processor = app.get(OutboxProcessor);
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  beforeEach(() => harness.reset());

  function server(): ReturnType<INestApplication['getHttpServer']> {
    return app.getHttpServer();
  }

  function cookieValue(res: request.Response, name: string): string {
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    const raw = setCookie?.find((entry) => entry.startsWith(`${name}=`));
    if (!raw) {
      throw new Error(`Cookie "${name}" was not set on the response`);
    }
    return raw.split(';')[0]!.slice(name.length + 1);
  }

  async function registerUser(email: string): Promise<TestUser> {
    const csrfRes = await request(server()).get('/api/v1/auth/csrf').expect(200);
    const csrfToken = csrfRes.body.data.csrfToken as string;

    const res = await request(server())
      .post('/api/v1/auth/register')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ email, password: 'correct horse battery staple', displayName: email.split('@')[0] })
      .expect(201);

    return {
      id: res.body.data.user.id as string,
      cookie: `csrf_token=${csrfToken}; access_token=${cookieValue(res, 'access_token')}`,
      csrfToken,
    };
  }

  function setBalance(userId: string, balanceMinor: bigint): Promise<unknown> {
    return prisma.wallet.update({ where: { userId }, data: { balanceMinor } });
  }

  function walletBalance(userId: string): Promise<bigint> {
    return prisma.wallet.findUniqueOrThrow({ where: { userId } }).then((w) => w.balanceMinor);
  }

  function sendTransfer(actor: TestUser, body: Record<string, unknown>): request.Test {
    return request(server())
      .post('/api/v1/transfers')
      .set('Cookie', actor.cookie)
      .set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  }

  function createRequest(actor: TestUser, body: Record<string, unknown>): request.Test {
    return request(server())
      .post('/api/v1/money-requests')
      .set('Cookie', actor.cookie)
      .set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  }

  function actOnRequest(
    actor: TestUser,
    id: string,
    action: 'accept' | 'decline' | 'cancel',
  ): request.Test {
    return request(server())
      .post(`/api/v1/money-requests/${id}/${action}`)
      .set('Cookie', actor.cookie)
      .set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({});
  }

  function listNotifications(actor: TestUser, queryString = ''): request.Test {
    return request(server()).get(`/api/v1/notifications${queryString}`).set('Cookie', actor.cookie);
  }

  describe('AC-7 — the worker is never on the financial critical path', () => {
    it('commits the transfer and its outbox event together, with no worker running', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);
      await setBalance(bob.id, 0n);

      // No drain() call anywhere in this test — the worker is effectively down.
      const res = await sendTransfer(alice, {
        receiverUserId: bob.id,
        amountMinor: 25_000,
      }).expect(201);

      expect(await walletBalance(alice.id)).toBe(75_000n);
      expect(await walletBalance(bob.id)).toBe(25_000n);

      const events = await prisma.outboxEvent.findMany();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        eventType: 'transfer.succeeded',
        aggregateId: res.body.data.transferId,
        processedAt: null,
        attemptCount: 0,
      });

      // Nothing consumed it yet, so no notification exists.
      expect(await prisma.notification.count()).toBe(0);
    });

    it('delivers the notification once the worker resumes', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);

      await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 25_000 }).expect(201);
      expect(await prisma.notification.count()).toBe(0);

      const processed = await processor.drain();
      expect(processed).toBe(1);

      const events = await prisma.outboxEvent.findMany();
      expect(events[0]!.processedAt).not.toBeNull();

      const feed = await listNotifications(bob).expect(200);
      expect(feed.body.data).toHaveLength(1);
      expect(feed.body.data[0]).toMatchObject({
        type: 'money_received',
        resourceType: 'transfer',
        readAt: null,
      });
      // Amount is rendered from integer minor units — never float arithmetic.
      expect(feed.body.data[0].body).toContain('250.00');
    });
  });

  describe('at-least-once delivery', () => {
    it('does not create a duplicate notification when an event is processed twice', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);

      await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 10_000 }).expect(201);
      await processor.drain();
      expect(await prisma.notification.count()).toBe(1);

      // Simulate a redelivery: reopen the event exactly as a crash between the
      // consumer's commit and the processed flag would leave it.
      await prisma.outboxEvent.updateMany({ data: { processedAt: null } });
      await processor.drain();

      expect(await prisma.notification.count()).toBe(1);
    });

    it('increments the attempt count and records the error when a consumer fails', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);

      await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 10_000 }).expect(201);

      const consumer = app.get(NotificationConsumer);
      const spy = jest
        .spyOn(consumer, 'handle')
        .mockRejectedValueOnce(new Error('consumer exploded'));

      try {
        await processor.drain();
      } finally {
        spy.mockRestore();
      }

      const event = await prisma.outboxEvent.findFirstOrThrow();
      expect(event.attemptCount).toBe(1);
      expect(event.processedAt).toBeNull();
      expect(event.lastError).toContain('consumer exploded');
      expect(await prisma.notification.count()).toBe(0);

      // The financial effect is untouched by the consumer failure.
      expect(await walletBalance(alice.id)).toBe(90_000n);
      expect(await walletBalance(bob.id)).toBe(10_010_000n);
    });

    it('stops claiming an event once it exhausts its attempt budget', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);

      await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 10_000 }).expect(201);

      // Park the event at the dead-letter boundary, past any backoff.
      await prisma.outboxEvent.updateMany({
        data: { attemptCount: MAX_ATTEMPTS, nextAttemptAt: new Date(Date.now() - 60_000) },
      });

      expect(await processor.drain()).toBe(0);
      expect(await prisma.notification.count()).toBe(0);
      expect((await prisma.outboxEvent.findFirstOrThrow()).processedAt).toBeNull();
    });

    it('marks an event with no interested consumer as processed rather than retrying it', async () => {
      const alice = await registerUser('alice@example.com');
      await prisma.outboxEvent.create({
        data: {
          aggregateType: 'user',
          aggregateId: alice.id,
          eventType: 'something.unhandled',
          payload: {},
        },
      });

      expect(await processor.drain()).toBe(1);
      const event = await prisma.outboxEvent.findFirstOrThrow();
      expect(event.processedAt).not.toBeNull();
      expect(event.attemptCount).toBe(0);
      expect(await prisma.notification.count()).toBe(0);
    });
  });

  describe('money-request notifications', () => {
    it('notifies the payer on create and the requester on accept, without double-reporting the transfer', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(bob.id, 100_000n);

      const created = await createRequest(alice, {
        payerUserId: bob.id,
        amountMinor: 30_000,
      }).expect(201);
      const requestId = created.body.data.requestId as string;

      await processor.drain();
      const payerFeed = await listNotifications(bob).expect(200);
      expect(payerFeed.body.data).toHaveLength(1);
      expect(payerFeed.body.data[0]).toMatchObject({
        type: 'money_request_received',
        resourceType: 'money_request',
        resourceId: requestId,
      });

      await actOnRequest(bob, requestId, 'accept').expect(200);
      await processor.drain();

      // Alice gets exactly one notification: the acceptance. The linked
      // transfer's `transfer.succeeded` must not also report "money received".
      const requesterFeed = await listNotifications(alice).expect(200);
      expect(requesterFeed.body.data).toHaveLength(1);
      expect(requesterFeed.body.data[0]).toMatchObject({
        type: 'money_request_accepted',
        resourceId: requestId,
      });
    });

    it('notifies the requester on decline and the payer on cancel', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');

      const declined = await createRequest(alice, {
        payerUserId: bob.id,
        amountMinor: 5_000,
      }).expect(201);
      await actOnRequest(bob, declined.body.data.requestId as string, 'decline').expect(200);

      const cancelled = await createRequest(alice, {
        payerUserId: bob.id,
        amountMinor: 6_000,
      }).expect(201);
      await actOnRequest(alice, cancelled.body.data.requestId as string, 'cancel').expect(200);

      await processor.drain();

      const aliceTypes = (await listNotifications(alice).expect(200)).body.data.map(
        (n: { type: string }) => n.type,
      );
      const bobTypes = (await listNotifications(bob).expect(200)).body.data.map(
        (n: { type: string }) => n.type,
      );

      expect(aliceTypes).toContain('money_request_declined');
      expect(bobTypes).toContain('money_request_cancelled');
      // Both creates notified the payer; the cancel notified the payer too.
      expect(bobTypes.filter((t: string) => t === 'money_request_received')).toHaveLength(2);
    });
  });

  describe('notification ownership and paging', () => {
    it('shows a user only their own notifications', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      const carol = await registerUser('carol@example.com');
      await setBalance(alice.id, 100_000n);

      await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 10_000 }).expect(201);
      await processor.drain();

      expect((await listNotifications(bob).expect(200)).body.data).toHaveLength(1);
      expect((await listNotifications(alice).expect(200)).body.data).toHaveLength(0);
      expect((await listNotifications(carol).expect(200)).body.data).toHaveLength(0);
    });

    it("refuses to let an unrelated user mark someone else's notification read", async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      const carol = await registerUser('carol@example.com');
      await setBalance(alice.id, 100_000n);

      await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 10_000 }).expect(201);
      await processor.drain();

      const notificationId = (await listNotifications(bob).expect(200)).body.data[0]
        .notificationId as string;

      const forbidden = await request(server())
        .post(`/api/v1/notifications/${notificationId}/read`)
        .set('Cookie', carol.cookie)
        .set('X-CSRF-Token', carol.csrfToken)
        .send({})
        .expect(404);
      expect(forbidden.body.error.code).toBe('NOT_FOUND');

      // Still unread — Carol's attempt changed nothing.
      expect(await prisma.notification.count({ where: { readAt: null } })).toBe(1);

      const owned = await request(server())
        .post(`/api/v1/notifications/${notificationId}/read`)
        .set('Cookie', bob.cookie)
        .set('X-CSRF-Token', bob.csrfToken)
        .send({})
        .expect(200);
      expect(owned.body.data.readAt).not.toBeNull();
    });

    it('pages newest-first with a stable cursor', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);

      for (let i = 0; i < 5; i++) {
        await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 1_000 }).expect(201);
      }
      await processor.drain();

      const first = await listNotifications(bob, '?limit=2').expect(200);
      expect(first.body.data).toHaveLength(2);
      const cursor = first.body.meta.nextCursor as string;
      expect(cursor).not.toBeNull();

      const second = await listNotifications(
        bob,
        `?limit=2&cursor=${encodeURIComponent(cursor)}`,
      ).expect(200);

      const firstIds = first.body.data.map((n: { notificationId: string }) => n.notificationId);
      const secondIds = second.body.data.map((n: { notificationId: string }) => n.notificationId);
      expect(secondIds.filter((id: string) => firstIds.includes(id))).toHaveLength(0);

      const timestamps = first.body.data.map((n: { createdAt: string }) =>
        new Date(n.createdAt).getTime(),
      );
      expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));

      const unread = await listNotifications(bob, '?unreadOnly=true&limit=50').expect(200);
      expect(unread.body.data).toHaveLength(5);
    });
  });
});
