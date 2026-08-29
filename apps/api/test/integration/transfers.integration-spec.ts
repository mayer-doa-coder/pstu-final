import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/database/prisma.service';
import { TransfersRepository } from '../../src/transfers/transfers.repository';

/**
 * Milestone 3 correctness proofs for the direct-transfer core, exercised
 * against a real Postgres container and the full HTTP pipeline — the money
 * movement, row locking, idempotency, and ledger invariants are only
 * meaningful against a real database (AGENT.md §6).
 *
 * Maps to IMPLEMENTATION_GUIDE.md §5.2: AC-1 (no partial transfer),
 * AC-2 (idempotent retry), AC-3 (concurrent overspend), AC-5 (authz),
 * AC-6 (balanced ledger), AC-7 (outbox written, worker not required).
 */
describe('Direct transfer core (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;

  interface TestUser {
    id: string;
    cookie: string;
    csrfToken: string;
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();

    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.JWT_ACCESS_SECRET = 'integration-test-secret-at-least-32-characters-long';
    process.env.NODE_ENV = 'test';

    const repoRoot = path.resolve(__dirname, '../../../..');
    const schemaPath = path.join(repoRoot, 'database', 'prisma', 'schema.prisma');
    const prismaCliEntry = path.join(repoRoot, 'node_modules', 'prisma', 'build', 'index.js');

    execFileSync(process.execPath, [prismaCliEntry, 'migrate', 'deploy', '--schema', schemaPath], {
      env: process.env,
      stdio: 'pipe',
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await container.stop();
  });

  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await prisma.idempotencyRecord.deleteMany();
    await prisma.transfer.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.wallet.deleteMany();
    await prisma.user.deleteMany();
  });

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

  function sendTransfer(
    actor: TestUser,
    body: Record<string, unknown>,
    idempotencyKey: string = randomUUID(),
  ): request.Test {
    return request(server())
      .post('/api/v1/transfers')
      .set('Cookie', actor.cookie)
      .set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);
  }

  function setBalance(userId: string, balanceMinor: bigint): Promise<unknown> {
    return prisma.wallet.update({ where: { userId }, data: { balanceMinor } });
  }

  function walletBalance(userId: string): Promise<bigint> {
    return prisma.wallet.findUniqueOrThrow({ where: { userId } }).then((w) => w.balanceMinor);
  }

  describe('successful transfer', () => {
    it('moves the exact amount, returns a receipt, and writes a balanced ledger pair', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 500_000n);
      await setBalance(bob.id, 100_000n);

      const res = await sendTransfer(alice, {
        receiverUserId: bob.id,
        amountMinor: 250_000,
        note: 'Dinner',
      }).expect(201);

      expect(res.body.data).toMatchObject({
        status: 'SUCCEEDED',
        senderUserId: alice.id,
        receiverUserId: bob.id,
        amountMinor: 250_000,
        currency: 'BDT',
        note: 'Dinner',
        senderBalanceAfterMinor: 250_000,
      });
      expect(res.body.data.completedAt).not.toBeNull();

      expect(await walletBalance(alice.id)).toBe(250_000n);
      expect(await walletBalance(bob.id)).toBe(350_000n);

      const transferId = res.body.data.transferId as string;
      const entries = await prisma.ledgerEntry.findMany({
        where: { transferId },
        orderBy: { direction: 'asc' },
      });
      expect(entries).toHaveLength(2);

      const debit = entries.find((e) => e.direction === 'DEBIT')!;
      const credit = entries.find((e) => e.direction === 'CREDIT')!;
      expect(debit.walletId).not.toBe(credit.walletId);
      expect(debit.signedAmountMinor).toBe(-250_000n);
      expect(credit.signedAmountMinor).toBe(250_000n);
      expect(debit.balanceAfterMinor).toBe(250_000n);
      expect(credit.balanceAfterMinor).toBe(350_000n);

      // AC-6: signed ledger sum for the transfer is exactly zero.
      const [{ sum }] = await prisma.$queryRaw<Array<{ sum: bigint | null }>>`
        SELECT SUM(signed_amount_minor)::bigint AS sum FROM ledger_entries WHERE transfer_id = ${transferId}::uuid
      `;
      expect(sum).toBe(0n);

      // AC-7: outbox event written in the same transaction, still unprocessed.
      const events = await prisma.outboxEvent.findMany({ where: { aggregateId: transferId } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ eventType: 'transfer.succeeded', processedAt: null });
    });

    it('lets either participant fetch the transfer, but not an unrelated user', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      const carol = await registerUser('carol@example.com');

      const created = await sendTransfer(alice, {
        receiverUserId: bob.id,
        amountMinor: 10_000,
      }).expect(201);
      const transferId = created.body.data.transferId as string;

      await request(server())
        .get(`/api/v1/transfers/${transferId}`)
        .set('Cookie', alice.cookie)
        .expect(200);
      await request(server())
        .get(`/api/v1/transfers/${transferId}`)
        .set('Cookie', bob.cookie)
        .expect(200);

      // AC-5: a non-participant gets 404 (no existence leak), no mutation.
      const forbidden = await request(server())
        .get(`/api/v1/transfers/${transferId}`)
        .set('Cookie', carol.cookie)
        .expect(404);
      expect(forbidden.body.error.code).toBe('TRANSFER_NOT_FOUND');
    });
  });

  describe('rejected transfers (no financial effect)', () => {
    let alice: TestUser;
    let bob: TestUser;

    beforeEach(async () => {
      alice = await registerUser('alice@example.com');
      bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);
      await setBalance(bob.id, 0n);
    });

    async function expectNoMovement(): Promise<void> {
      expect(await walletBalance(alice.id)).toBe(100_000n);
      expect(await walletBalance(bob.id)).toBe(0n);
      expect(await prisma.transfer.count()).toBe(0);
      expect(await prisma.ledgerEntry.count()).toBe(0);
    }

    it('rejects amount = 0', async () => {
      const res = await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 0 }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      await expectNoMovement();
    });

    it('rejects a negative amount', async () => {
      const res = await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: -5_000 }).expect(
        400,
      );
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      await expectNoMovement();
    });

    it('rejects a self-transfer', async () => {
      const res = await sendTransfer(alice, {
        receiverUserId: alice.id,
        amountMinor: 1_000,
      }).expect(422);
      expect(res.body.error.code).toBe('INVALID_TRANSFER');
      await expectNoMovement();
    });

    it('rejects an amount over the available balance', async () => {
      const res = await sendTransfer(alice, {
        receiverUserId: bob.id,
        amountMinor: 100_001,
      }).expect(409);
      expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
      await expectNoMovement();
    });

    it('rejects a transfer from a frozen wallet', async () => {
      await prisma.wallet.update({ where: { userId: alice.id }, data: { status: 'FROZEN' } });
      const res = await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 1_000 }).expect(
        409,
      );
      expect(res.body.error.code).toBe('WALLET_UNAVAILABLE');
      await expectNoMovement();
    });

    it('rejects a transfer to a suspended recipient', async () => {
      await prisma.user.update({ where: { id: bob.id }, data: { status: 'SUSPENDED' } });
      const res = await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 1_000 }).expect(
        404,
      );
      expect(res.body.error.code).toBe('USER_NOT_FOUND');
      await expectNoMovement();
    });

    it('rejects a transfer to a non-existent user', async () => {
      const res = await sendTransfer(alice, {
        receiverUserId: randomUUID(),
        amountMinor: 1_000,
      }).expect(404);
      expect(res.body.error.code).toBe('USER_NOT_FOUND');
      await expectNoMovement();
    });

    it('requires an Idempotency-Key header', async () => {
      const res = await request(server())
        .post('/api/v1/transfers')
        .set('Cookie', alice.cookie)
        .set('X-CSRF-Token', alice.csrfToken)
        .send({ receiverUserId: bob.id, amountMinor: 1_000 })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      await expectNoMovement();
    });
  });

  describe('AC-1 — a mid-transaction failure rolls back every financial effect', () => {
    it('leaves balances, ledger, transfers, and idempotency untouched', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);

      const repo = app.get(TransfersRepository);
      const spy = jest
        .spyOn(repo, 'markSucceeded')
        .mockRejectedValueOnce(new Error('injected failure after debit/credit'));

      try {
        await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 40_000 }).expect(500);
      } finally {
        spy.mockRestore();
      }

      expect(await walletBalance(alice.id)).toBe(100_000n);
      expect(await walletBalance(bob.id)).toBe(10_000_000n);
      expect(await prisma.transfer.count()).toBe(0);
      expect(await prisma.ledgerEntry.count()).toBe(0);
      expect(await prisma.idempotencyRecord.count()).toBe(0);
      expect(await prisma.outboxEvent.count()).toBe(0);
    });
  });

  describe('AC-2 — idempotent retry creates exactly one effect', () => {
    it('replays the original receipt for repeated calls with the same key and body', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);

      const key = randomUUID();
      const body = { receiverUserId: bob.id, amountMinor: 30_000, note: 'once' };

      const first = await sendTransfer(alice, body, key).expect(201);
      const transferId = first.body.data.transferId as string;

      for (let i = 0; i < 5; i++) {
        const replay = await sendTransfer(alice, body, key).expect(201);
        expect(replay.body.data.transferId).toBe(transferId);
        expect(replay.body.data.senderBalanceAfterMinor).toBe(70_000);
      }

      expect(await walletBalance(alice.id)).toBe(70_000n);
      expect(await prisma.transfer.count()).toBe(1);
      expect(await prisma.ledgerEntry.count()).toBe(2);
    });

    it('collapses concurrent same-key submissions (double-click) to one transfer', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);

      const key = randomUUID();
      const body = { receiverUserId: bob.id, amountMinor: 25_000 };

      const results = await Promise.all(
        Array.from({ length: 6 }, () => sendTransfer(alice, body, key)),
      );

      for (const res of results) {
        expect(res.status).toBe(201);
      }
      const ids = new Set(results.map((r) => r.body.data.transferId as string));
      expect(ids.size).toBe(1);

      expect(await walletBalance(alice.id)).toBe(75_000n);
      expect(await prisma.transfer.count()).toBe(1);
      expect(await prisma.ledgerEntry.count()).toBe(2);
    });

    it('returns 409 IDEMPOTENCY_KEY_REUSED when the same key carries a different payload', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);

      const key = randomUUID();
      await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 10_000 }, key).expect(201);

      const conflict = await sendTransfer(
        alice,
        { receiverUserId: bob.id, amountMinor: 99_999 },
        key,
      ).expect(409);
      expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

      // Only the first transfer's effect exists.
      expect(await walletBalance(alice.id)).toBe(90_000n);
      expect(await prisma.transfer.count()).toBe(1);
    });
  });

  describe('AC-3 — concurrent overspend prevention', () => {
    it('lets exactly one of two competing over-balance transfers succeed', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');

      for (let round = 0; round < 5; round++) {
        await prisma.ledgerEntry.deleteMany();
        await prisma.transfer.deleteMany();
        await prisma.idempotencyRecord.deleteMany();
        await setBalance(alice.id, 100n);
        await setBalance(bob.id, 0n);

        const [a, b] = await Promise.all([
          sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 80 }),
          sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 80 }),
        ]);

        const statuses = [a.status, b.status].sort((x, y) => x - y);
        expect(statuses).toEqual([201, 409]);

        const failed = [a, b].find((r) => r.status === 409)!;
        expect(failed.body.error.code).toBe('INSUFFICIENT_BALANCE');

        expect(await walletBalance(alice.id)).toBe(20n);
        expect(await walletBalance(bob.id)).toBe(80n);
        expect(await prisma.transfer.count({ where: { status: 'SUCCEEDED' } })).toBe(1);

        const negative = await prisma.wallet.count({ where: { balanceMinor: { lt: 0n } } });
        expect(negative).toBe(0);
      }
    });

    it('holds under a larger concurrent fan-out from one wallet', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 300n);
      await setBalance(bob.id, 0n);

      // 10 transfers of 100 against a balance of 300 -> at most 3 succeed.
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 100 }),
        ),
      );

      const succeeded = results.filter((r) => r.status === 201).length;
      const failed = results.filter((r) => r.status === 409).length;
      expect(succeeded).toBe(3);
      expect(failed).toBe(7);

      expect(await walletBalance(alice.id)).toBe(0n);
      expect(await walletBalance(bob.id)).toBe(300n);
      expect(await prisma.transfer.count({ where: { status: 'SUCCEEDED' } })).toBe(3);
    });
  });
});
