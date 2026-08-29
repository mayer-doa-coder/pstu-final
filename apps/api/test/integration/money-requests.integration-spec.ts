import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../../src/database/prisma.service';
import { type IntegrationApp, startIntegrationApp } from './support/integration-app';

/**
 * Money-request lifecycle proofs against a real Postgres container and the
 * full HTTP pipeline (AGENT.md §6). Covers create (no money movement),
 * accept (exactly one linked transfer via the transfer engine), decline,
 * cancel, durable idempotency, and the concurrency guarantee that exactly
 * one terminal outcome commits (AC-4).
 */
describe('Money requests (integration)', () => {
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

  const resetTables = (): Promise<void> => harness.reset();

  beforeEach(resetTables);

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

  function walletBalance(userId: string): Promise<bigint> {
    return prisma.wallet.findUniqueOrThrow({ where: { userId } }).then((w) => w.balanceMinor);
  }

  function createRequest(
    actor: TestUser,
    body: Record<string, unknown>,
    idempotencyKey: string = randomUUID(),
  ): request.Test {
    return request(server())
      .post('/api/v1/money-requests')
      .set('Cookie', actor.cookie)
      .set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);
  }

  function actOnRequest(
    actor: TestUser,
    id: string,
    action: 'accept' | 'decline' | 'cancel',
    idempotencyKey: string = randomUUID(),
  ): request.Test {
    return request(server())
      .post(`/api/v1/money-requests/${id}/${action}`)
      .set('Cookie', actor.cookie)
      .set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .send({});
  }

  /** requester asks payer for `amount`; returns the created request id. */
  async function openRequest(
    requester: TestUser,
    payer: TestUser,
    amountMinor: number,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await createRequest(requester, {
      payerUserId: payer.id,
      amountMinor,
      ...extra,
    }).expect(201);
    return res.body.data.requestId as string;
  }

  describe('create', () => {
    it('creates a PENDING request and moves no money', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);
      await setBalance(bob.id, 100_000n);

      const res = await createRequest(alice, {
        payerUserId: bob.id,
        amountMinor: 40_000,
        note: 'Lunch',
      }).expect(201);

      expect(res.body.data).toMatchObject({
        status: 'PENDING',
        requesterUserId: alice.id,
        payerUserId: bob.id,
        amountMinor: 40_000,
        currency: 'BDT',
        note: 'Lunch',
        acceptedTransferId: null,
      });

      expect(await walletBalance(alice.id)).toBe(100_000n);
      expect(await walletBalance(bob.id)).toBe(100_000n);
      expect(await prisma.transfer.count()).toBe(0);
      expect(await prisma.ledgerEntry.count()).toBe(0);
    });

    it('rejects a self-request', async () => {
      const alice = await registerUser('alice@example.com');
      const res = await createRequest(alice, { payerUserId: alice.id, amountMinor: 1_000 }).expect(
        422,
      );
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(await prisma.moneyRequest.count()).toBe(0);
    });

    it.each([0, -5_000])('rejects amountMinor = %d', async (amountMinor) => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      const res = await createRequest(alice, { payerUserId: bob.id, amountMinor }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(await prisma.moneyRequest.count()).toBe(0);
    });

    it('replays the original request for a repeated key + body, and rejects a changed payload', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      const key = randomUUID();
      const body = { payerUserId: bob.id, amountMinor: 12_000 };

      const first = await createRequest(alice, body, key).expect(201);
      const replay = await createRequest(alice, body, key).expect(201);
      expect(replay.body.data.requestId).toBe(first.body.data.requestId);
      expect(await prisma.moneyRequest.count()).toBe(1);

      const conflict = await createRequest(
        alice,
        { payerUserId: bob.id, amountMinor: 99_999 },
        key,
      ).expect(409);
      expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await prisma.moneyRequest.count()).toBe(1);
    });

    it("never exposes internal or another user's private fields", async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      const res = await createRequest(alice, { payerUserId: bob.id, amountMinor: 1_000 }).expect(
        201,
      );

      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toMatch(/passwordHash|password_hash/);
      expect(serialized).not.toMatch(/balanceMinor|balance_minor/);
      expect(serialized).not.toMatch(/refreshToken|request_hash|idempotency/i);
    });
  });

  describe('accept', () => {
    it('creates exactly one linked transfer and moves the balances once', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 20_000n); // requester
      await setBalance(bob.id, 500_000n); // payer

      const requestId = await openRequest(alice, bob, 150_000);
      const res = await actOnRequest(bob, requestId, 'accept').expect(200);

      expect(res.body.data.status).toBe('ACCEPTED');
      const transferId = res.body.data.acceptedTransferId as string;
      expect(transferId).toEqual(expect.any(String));

      const transfers = await prisma.transfer.findMany();
      expect(transfers).toHaveLength(1);
      expect(transfers[0]).toMatchObject({
        id: transferId,
        senderUserId: bob.id,
        receiverUserId: alice.id,
        amountMinor: 150_000n,
        status: 'SUCCEEDED',
        sourceType: 'MONEY_REQUEST',
        sourceRequestId: requestId,
      });

      expect(await walletBalance(bob.id)).toBe(350_000n);
      expect(await walletBalance(alice.id)).toBe(170_000n);
      expect(await prisma.ledgerEntry.count()).toBe(2);

      const [{ sum }] = await prisma.$queryRaw<Array<{ sum: bigint | null }>>`
        SELECT SUM(signed_amount_minor)::bigint AS sum FROM ledger_entries WHERE transfer_id = ${transferId}::uuid
      `;
      expect(sum).toBe(0n);
    });

    it('only the payer may accept', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      const carol = await registerUser('carol@example.com');
      await setBalance(bob.id, 100_000n);

      const requestId = await openRequest(alice, bob, 10_000);

      const byRequester = await actOnRequest(alice, requestId, 'accept').expect(403);
      expect(byRequester.body.error.code).toBe('FORBIDDEN');

      const byStranger = await actOnRequest(carol, requestId, 'accept').expect(404);
      expect(byStranger.body.error.code).toBe('MONEY_REQUEST_NOT_FOUND');

      expect(await prisma.transfer.count()).toBe(0);
      expect(
        (await prisma.moneyRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
      ).toBe('PENDING');
    });

    it('rejects acceptance when the payer has insufficient balance, leaving the request PENDING', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(bob.id, 5_000n);

      const requestId = await openRequest(alice, bob, 10_000);
      const res = await actOnRequest(bob, requestId, 'accept').expect(409);
      expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');

      expect(await prisma.transfer.count()).toBe(0);
      expect(
        (await prisma.moneyRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
      ).toBe('PENDING');
    });

    it('replays the acceptance for a repeated key and never double-settles', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(bob.id, 100_000n);
      await setBalance(alice.id, 0n);

      const requestId = await openRequest(alice, bob, 30_000);
      const key = randomUUID();

      const first = await actOnRequest(bob, requestId, 'accept', key).expect(200);
      for (let i = 0; i < 4; i++) {
        const replay = await actOnRequest(bob, requestId, 'accept', key).expect(200);
        expect(replay.body.data.acceptedTransferId).toBe(first.body.data.acceptedTransferId);
      }

      // A fresh key against the now-ACCEPTED request is rejected, not re-run.
      const resolved = await actOnRequest(bob, requestId, 'accept').expect(409);
      expect(resolved.body.error.code).toBe('REQUEST_ALREADY_RESOLVED');

      expect(await prisma.transfer.count()).toBe(1);
      expect(await walletBalance(bob.id)).toBe(70_000n);
      expect(await walletBalance(alice.id)).toBe(30_000n);
    });

    it('rejects an expired request', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(bob.id, 100_000n);

      const requestId = await openRequest(alice, bob, 10_000);
      await prisma.moneyRequest.update({
        where: { id: requestId },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const res = await actOnRequest(bob, requestId, 'accept').expect(409);
      expect(res.body.error.code).toBe('REQUEST_ALREADY_RESOLVED');
      expect(await prisma.transfer.count()).toBe(0);

      // The read model reports the elapsed deadline as EXPIRED.
      const detail = await request(server())
        .get(`/api/v1/money-requests/${requestId}`)
        .set('Cookie', bob.cookie)
        .expect(200);
      expect(detail.body.data.status).toBe('EXPIRED');
    });
  });

  describe('decline / cancel', () => {
    it('lets only the payer decline a PENDING request, with no money movement', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 50_000n);
      await setBalance(bob.id, 50_000n);

      const requestId = await openRequest(alice, bob, 10_000);

      await actOnRequest(alice, requestId, 'decline').expect(403);
      const res = await actOnRequest(bob, requestId, 'decline').expect(200);
      expect(res.body.data.status).toBe('DECLINED');

      expect(await walletBalance(alice.id)).toBe(50_000n);
      expect(await walletBalance(bob.id)).toBe(50_000n);
      expect(await prisma.transfer.count()).toBe(0);
    });

    it('lets only the requester cancel a PENDING request', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');

      const requestId = await openRequest(alice, bob, 10_000);

      await actOnRequest(bob, requestId, 'cancel').expect(403);
      const res = await actOnRequest(alice, requestId, 'cancel').expect(200);
      expect(res.body.data.status).toBe('CANCELLED');
    });

    it.each(['accept', 'decline', 'cancel'] as const)(
      'rejects %s on an already-resolved request',
      async (action) => {
        const alice = await registerUser('alice@example.com');
        const bob = await registerUser('bob@example.com');
        await setBalance(bob.id, 100_000n);

        const requestId = await openRequest(alice, bob, 10_000);
        await actOnRequest(alice, requestId, 'cancel').expect(200);

        const actor = action === 'cancel' ? alice : bob;
        const res = await actOnRequest(actor, requestId, action).expect(409);
        expect(res.body.error.code).toBe('REQUEST_ALREADY_RESOLVED');
        expect(await prisma.transfer.count()).toBe(0);
      },
    );
  });

  describe('concurrency — exactly one terminal outcome commits', () => {
    it('collapses many concurrent accepts to one transfer', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(bob.id, 100_000n);
      await setBalance(alice.id, 0n);

      const requestId = await openRequest(alice, bob, 25_000);

      const results = await Promise.all(
        Array.from({ length: 6 }, () => actOnRequest(bob, requestId, 'accept', randomUUID())),
      );

      const ok = results.filter((r) => r.status === 200);
      const conflict = results.filter((r) => r.status === 409);
      expect(ok).toHaveLength(1);
      expect(conflict).toHaveLength(5);
      for (const r of conflict) {
        expect(r.body.error.code).toBe('REQUEST_ALREADY_RESOLVED');
      }

      expect(await prisma.transfer.count({ where: { status: 'SUCCEEDED' } })).toBe(1);
      expect(await walletBalance(bob.id)).toBe(75_000n);
      expect(await walletBalance(alice.id)).toBe(25_000n);
      expect(
        (await prisma.moneyRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
      ).toBe('ACCEPTED');
    });

    it.each(['decline', 'cancel'] as const)(
      'accept vs %s race resolves to exactly one outcome',
      async (competing) => {
        for (let round = 0; round < 4; round++) {
          await resetTables();

          const alice = await registerUser(`alice${round}@example.com`);
          const bob = await registerUser(`bob${round}@example.com`);
          await setBalance(bob.id, 100_000n);
          await setBalance(alice.id, 0n);

          const requestId = await openRequest(alice, bob, 10_000);
          const competingActor = competing === 'cancel' ? alice : bob;

          const [accept, other] = await Promise.all([
            actOnRequest(bob, requestId, 'accept', randomUUID()),
            actOnRequest(competingActor, requestId, competing, randomUUID()),
          ]);

          const statuses = [accept.status, other.status].sort((a, b) => a - b);
          expect(statuses).toEqual([200, 409]);

          const finalStatus = (
            await prisma.moneyRequest.findUniqueOrThrow({ where: { id: requestId } })
          ).status;
          const transferCount = await prisma.transfer.count();

          if (accept.status === 200) {
            expect(finalStatus).toBe('ACCEPTED');
            expect(transferCount).toBe(1);
            expect(await walletBalance(bob.id)).toBe(90_000n);
            expect(await walletBalance(alice.id)).toBe(10_000n);
          } else {
            expect(finalStatus).toBe(competing === 'cancel' ? 'CANCELLED' : 'DECLINED');
            expect(transferCount).toBe(0);
            expect(await walletBalance(bob.id)).toBe(100_000n);
            expect(await walletBalance(alice.id)).toBe(0n);
          }
        }
      },
    );
  });
});
