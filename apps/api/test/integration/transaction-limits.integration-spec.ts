import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../../src/database/prisma.service';
import { type IntegrationApp, startIntegrationApp } from './support/integration-app';

const PASSWORD = 'correct horse battery staple';

// Matches env.schema.ts's default DAILY_TRANSFER_LIMIT_MINOR (BDT 1,000,000).
// Not overridden per-test — every amount below is chosen relative to this.
const DAILY_LIMIT_MINOR = 100_000_000;

/**
 * Per-user rolling send limits (TransactionLimitService), exercised through
 * the real HTTP pipeline and a real Postgres container.
 */
describe('Transaction limits (integration)', () => {
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
      .send({ email, password: PASSWORD, displayName: email.split('@')[0] })
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

  function getWallet(actor: TestUser): request.Test {
    return request(server()).get('/api/v1/wallet').set('Cookie', actor.cookie);
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

  it('reports zero usage and the configured limits for a brand-new account', async () => {
    const alice = await registerUser('alice@example.com');
    const res = await getWallet(alice).expect(200);

    expect(res.body.data.limits.daily).toEqual({
      limitMinor: DAILY_LIMIT_MINOR,
      usedMinor: 0,
      remainingMinor: DAILY_LIMIT_MINOR,
    });
    // Registration itself already validated the response shape includes limits.
  });

  it('increments usage across all three windows after a successful transfer', async () => {
    const alice = await registerUser('alice@example.com');
    const bob = await registerUser('bob@example.com');
    await setBalance(alice.id, 500_000n);

    await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 300_000 }).expect(201);

    const wallet = await getWallet(alice).expect(200);
    for (const window of ['daily', 'weekly', 'monthly'] as const) {
      expect(wallet.body.data.limits[window].usedMinor).toBe(300_000);
      expect(wallet.body.data.limits[window].remainingMinor).toBe(
        wallet.body.data.limits[window].limitMinor - 300_000,
      );
    }
  });

  it('rejects a single transfer that alone exceeds the daily limit, with no financial effect', async () => {
    const alice = await registerUser('alice@example.com');
    const bob = await registerUser('bob@example.com');
    const overLimitAmount = DAILY_LIMIT_MINOR + 1;
    await setBalance(alice.id, BigInt(overLimitAmount) + 1_000n);

    const res = await sendTransfer(alice, {
      receiverUserId: bob.id,
      amountMinor: overLimitAmount,
    }).expect(409);

    expect(res.body.error.code).toBe('TRANSFER_LIMIT_EXCEEDED');
    expect(res.body.error.details).toMatchObject({ period: 'daily' });

    expect(await prisma.transfer.count()).toBe(0);
    expect(await walletBalance(alice.id)).toBe(BigInt(overLimitAmount) + 1_000n);
  });

  it('rejects the transfer that pushes cumulative daily usage over the limit, but keeps the first', async () => {
    const alice = await registerUser('alice@example.com');
    const bob = await registerUser('bob@example.com');
    const firstAmount = DAILY_LIMIT_MINOR - 100_000; // fits alone
    const secondAmount = 200_000; // first + second > DAILY_LIMIT_MINOR
    await setBalance(alice.id, BigInt(firstAmount) + BigInt(secondAmount) + 1_000n);

    await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: firstAmount }).expect(201);

    const rejected = await sendTransfer(alice, {
      receiverUserId: bob.id,
      amountMinor: secondAmount,
    }).expect(409);
    expect(rejected.body.error.code).toBe('TRANSFER_LIMIT_EXCEEDED');

    expect(await prisma.transfer.count()).toBe(1);
    const wallet = await getWallet(alice).expect(200);
    expect(wallet.body.data.limits.daily.usedMinor).toBe(firstAmount);

    // The rejected attempt used none of the allowance — usage reflects only
    // the one transfer that actually moved money.
    expect(await walletBalance(bob.id)).toBe(10_000_000n + BigInt(firstAmount));
  });

  it('applies the same limit to the payer when a money request is accepted', async () => {
    const alice = await registerUser('alice@example.com'); // requester
    const bob = await registerUser('bob@example.com'); // payer
    const overLimitAmount = DAILY_LIMIT_MINOR + 1;
    await setBalance(bob.id, BigInt(overLimitAmount) + 1_000n);

    const created = await request(server())
      .post('/api/v1/money-requests')
      .set('Cookie', alice.cookie)
      .set('X-CSRF-Token', alice.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({ payerUserId: bob.id, amountMinor: overLimitAmount })
      .expect(201);
    const requestId = created.body.data.requestId as string;

    const res = await request(server())
      .post(`/api/v1/money-requests/${requestId}/accept`)
      .set('Cookie', bob.cookie)
      .set('X-CSRF-Token', bob.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(409);
    expect(res.body.error.code).toBe('TRANSFER_LIMIT_EXCEEDED');

    // The request stays PENDING — the accept attempt rolled back completely,
    // not just the money movement.
    const stillPending = await prisma.moneyRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(stillPending.status).toBe('PENDING');
    expect(await prisma.transfer.count()).toBe(0);
  });
});
