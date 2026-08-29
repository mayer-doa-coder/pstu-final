import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../../src/database/prisma.service';
import { type IntegrationApp, startIntegrationApp } from './support/integration-app';

/**
 * Activity feed proofs (IMPLEMENTATION_GUIDE.md §3.8). Verifies the feed
 * combines transfers and money requests the caller participates in, orders
 * them reverse-chronologically, paginates by a stable keyset cursor, and
 * never leaks a resource to a non-participant.
 */
describe('Activity feed (integration)', () => {
  let harness: IntegrationApp;
  let app: INestApplication;
  let prisma: PrismaService;

  interface TestUser {
    id: string;
    cookie: string;
    csrfToken: string;
  }

  beforeAll(async () => {
    harness = await startIntegrationApp();
    app = harness.app;
    prisma = harness.prisma;
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

    const accessToken = cookieValue(res, 'access_token');
    return {
      id: res.body.data.user.id as string,
      cookie: `csrf_token=${csrfToken}; access_token=${accessToken}`,
      csrfToken,
    };
  }

  function setBalance(userId: string, balanceMinor: bigint): Promise<unknown> {
    return prisma.wallet.update({ where: { userId }, data: { balanceMinor } });
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

  function acceptRequest(actor: TestUser, id: string): request.Test {
    return request(server())
      .post(`/api/v1/money-requests/${id}/accept`)
      .set('Cookie', actor.cookie)
      .set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({});
  }

  function activity(actor: TestUser, queryString = ''): request.Test {
    return request(server()).get(`/api/v1/activity${queryString}`).set('Cookie', actor.cookie);
  }

  describe('composition & direction', () => {
    it('shows sent transfers as OUT and received transfers as IN, with the counterparty', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);

      await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 20_000 }).expect(201);

      const aliceFeed = await activity(alice).expect(200);
      expect(aliceFeed.body.data).toHaveLength(1);
      expect(aliceFeed.body.data[0]).toMatchObject({
        type: 'TRANSFER',
        direction: 'OUT',
        amountMinor: 20_000,
        status: 'SUCCEEDED',
        counterparty: { userId: bob.id, displayName: 'bob' },
      });

      const bobFeed = await activity(bob).expect(200);
      expect(bobFeed.body.data[0]).toMatchObject({
        type: 'TRANSFER',
        direction: 'IN',
        amountMinor: 20_000,
        counterparty: { userId: alice.id, displayName: 'alice' },
      });
    });

    it('shows a money request to both the requester and the payer as REQUEST', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');

      const created = await createRequest(alice, {
        payerUserId: bob.id,
        amountMinor: 15_000,
      }).expect(201);
      const requestId = created.body.data.requestId as string;

      const aliceFeed = await activity(alice).expect(200);
      expect(aliceFeed.body.data[0]).toMatchObject({
        type: 'MONEY_REQUEST',
        direction: 'REQUEST',
        referenceId: requestId,
        status: 'PENDING',
        counterparty: { userId: bob.id },
      });

      const bobFeed = await activity(bob).expect(200);
      expect(bobFeed.body.data[0]).toMatchObject({
        type: 'MONEY_REQUEST',
        referenceId: requestId,
        counterparty: { userId: alice.id },
      });
    });

    it('represents an accepted request as both a resolved request and its linked transfer', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(bob.id, 100_000n);

      const created = await createRequest(alice, {
        payerUserId: bob.id,
        amountMinor: 25_000,
      }).expect(201);
      const requestId = created.body.data.requestId as string;
      const accepted = await acceptRequest(bob, requestId).expect(200);
      const transferId = accepted.body.data.acceptedTransferId as string;

      const bobFeed = await activity(bob).expect(200);
      const requestItem = bobFeed.body.data.find(
        (i: { type: string }) => i.type === 'MONEY_REQUEST',
      );
      const transferItem = bobFeed.body.data.find((i: { type: string }) => i.type === 'TRANSFER');

      expect(requestItem).toMatchObject({
        referenceId: requestId,
        status: 'ACCEPTED',
        relatedTransferId: transferId,
      });
      expect(transferItem).toMatchObject({
        referenceId: transferId,
        direction: 'OUT',
        relatedRequestId: requestId,
        status: 'SUCCEEDED',
      });
    });
  });

  describe('ordering & pagination', () => {
    async function seedActivity(actor: TestUser, peer: TestUser, count: number): Promise<void> {
      await setBalance(actor.id, BigInt(count) * 1_000n + 1_000n);
      for (let i = 0; i < count; i++) {
        await sendTransfer(actor, { receiverUserId: peer.id, amountMinor: 1_000 }).expect(201);
      }
    }

    it('returns items newest-first', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await seedActivity(alice, bob, 5);

      const feed = await activity(alice).expect(200);
      const timestamps = feed.body.data.map((i: { createdAt: string }) =>
        new Date(i.createdAt).getTime(),
      );
      const sorted = [...timestamps].sort((a, b) => b - a);
      expect(timestamps).toEqual(sorted);
    });

    it('walks every item exactly once across cursor pages with no overlap', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await seedActivity(alice, bob, 7);

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 10; guard++) {
        const qs: string = cursor ? `?limit=3&cursor=${encodeURIComponent(cursor)}` : '?limit=3';
        const page = await activity(alice, qs).expect(200);
        expect(page.body.data.length).toBeLessThanOrEqual(3);
        for (const item of page.body.data) {
          seen.push(item.referenceId as string);
        }
        cursor = page.body.meta.nextCursor as string | null;
        if (!cursor) {
          break;
        }
      }

      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
    });

    it('keeps pagination stable when new activity is inserted mid-walk', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await seedActivity(alice, bob, 4);

      const firstPage = await activity(alice, '?limit=2').expect(200);
      const cursor = firstPage.body.meta.nextCursor as string;
      const firstIds = firstPage.body.data.map((i: { referenceId: string }) => i.referenceId);

      // New activity after the cursor anchor must not shift the older page.
      await setBalance(alice.id, 10_000n);
      await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 500 }).expect(201);

      const secondPage = await activity(
        alice,
        `?limit=2&cursor=${encodeURIComponent(cursor)}`,
      ).expect(200);
      const secondIds = secondPage.body.data.map((i: { referenceId: string }) => i.referenceId);

      expect(secondIds).toHaveLength(2);
      expect(secondIds.filter((id: string) => firstIds.includes(id))).toHaveLength(0);
    });

    it('rejects a malformed cursor', async () => {
      const alice = await registerUser('alice@example.com');
      const res = await activity(alice, '?cursor=not-a-real-cursor').expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('authorization & privacy', () => {
    it('never surfaces a resource to an unrelated user', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      const carol = await registerUser('carol@example.com');
      await setBalance(alice.id, 100_000n);

      const transfer = await sendTransfer(alice, {
        receiverUserId: bob.id,
        amountMinor: 10_000,
      }).expect(201);
      const created = await createRequest(alice, {
        payerUserId: bob.id,
        amountMinor: 5_000,
      }).expect(201);
      const transferId = transfer.body.data.transferId as string;
      const requestId = created.body.data.requestId as string;

      const carolFeed = await activity(carol).expect(200);
      expect(carolFeed.body.data).toHaveLength(0);

      await request(server())
        .get(`/api/v1/transfers/${transferId}`)
        .set('Cookie', carol.cookie)
        .expect(404);
      const reqProbe = await request(server())
        .get(`/api/v1/money-requests/${requestId}`)
        .set('Cookie', carol.cookie)
        .expect(404);
      expect(reqProbe.body.error.code).toBe('MONEY_REQUEST_NOT_FOUND');
    });

    it('does not expose internal or counterparty-private fields in the feed', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);
      await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 10_000 }).expect(201);

      const feed = await activity(alice).expect(200);
      const serialized = JSON.stringify(feed.body);
      expect(serialized).not.toMatch(/passwordHash|password_hash/);
      expect(serialized).not.toMatch(/balanceMinor|balance_minor/);
      expect(serialized).not.toMatch(/refreshToken|request_hash/i);
      expect(feed.body.data[0].counterparty).toEqual({
        userId: bob.id,
        displayName: 'bob',
      });
    });
  });
});
