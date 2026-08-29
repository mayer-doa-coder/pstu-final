import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../../src/database/prisma.service';
import { type IntegrationApp, startIntegrationApp } from './support/integration-app';

// Digit sum 45 -> 45 % 10 !== 0 -> the simulated verifier reports VERIFIED.
const VERIFIABLE_NID = '1234567890';
// Digit sum 50 -> 50 % 10 === 0 -> deterministically REJECTED.
const REJECTED_NID = '5555555555';
const PASSWORD = 'correct horse battery staple';

/**
 * Account verification (simulated NID/KYC) and the deterministic fraud/risk
 * engine, exercised through the real HTTP pipeline and a real Postgres
 * container — both are new, compact features layered on the existing
 * transfer core, not a redesign of it.
 */
describe('Verification and risk engine (integration)', () => {
  let harness: IntegrationApp;
  let app: INestApplication;
  let prisma: PrismaService;

  interface TestUser {
    id: string;
    email: string;
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
      email,
      cookie: `csrf_token=${csrfToken}; access_token=${cookieValue(res, 'access_token')}`,
      csrfToken,
    };
  }

  function submitNid(actor: TestUser, nidNumber: string): request.Test {
    return request(server())
      .post('/api/v1/verification/nid')
      .set('Cookie', actor.cookie)
      .set('X-CSRF-Token', actor.csrfToken)
      .send({ nidNumber });
  }

  function setBalance(userId: string, balanceMinor: bigint): Promise<unknown> {
    return prisma.wallet.update({ where: { userId }, data: { balanceMinor } });
  }

  function backdateAccount(userId: string, daysAgo: number): Promise<unknown> {
    return prisma.user.update({
      where: { id: userId },
      data: { createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000) },
    });
  }

  function sendTransfer(actor: TestUser, body: Record<string, unknown>): request.Test {
    return request(server())
      .post('/api/v1/transfers')
      .set('Cookie', actor.cookie)
      .set('X-CSRF-Token', actor.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  }

  describe('account verification', () => {
    it('defaults every new account to UNVERIFIED with no masked NID', async () => {
      const alice = await registerUser('alice@example.com');
      const me = await request(server())
        .get('/api/v1/users/me')
        .set('Cookie', alice.cookie)
        .expect(200);
      expect(me.body.data).toMatchObject({ verificationStatus: 'UNVERIFIED', nidMasked: null });
    });

    it('verifies a well-formed NID that passes the deterministic check, and audits it', async () => {
      const alice = await registerUser('alice@example.com');

      const res = await submitNid(alice, VERIFIABLE_NID).expect(201);
      expect(res.body.data).toMatchObject({
        verificationStatus: 'VERIFIED',
        nidMasked: '••••••7890',
      });
      expect(res.body.data.verifiedAt).not.toBeNull();

      const me = await request(server())
        .get('/api/v1/users/me')
        .set('Cookie', alice.cookie)
        .expect(200);
      expect(me.body.data.verificationStatus).toBe('VERIFIED');

      const audit = await prisma.auditEvent.findFirst({
        where: { action: 'user.nid_verified', actorUserId: alice.id },
      });
      expect(audit).not.toBeNull();
      expect(audit!.metadata).toMatchObject({ nidMasked: '••••••7890' });
      // The full NID must never appear anywhere in the audit trail.
      expect(JSON.stringify(audit!.metadata)).not.toContain(VERIFIABLE_NID);
    });

    it('rejects a well-formed NID that fails the deterministic check, and allows resubmission', async () => {
      const alice = await registerUser('alice@example.com');

      const rejected = await submitNid(alice, REJECTED_NID).expect(201);
      expect(rejected.body.data.verificationStatus).toBe('REJECTED');
      expect(rejected.body.data.verifiedAt).toBeNull();

      const audit = await prisma.auditEvent.findFirst({
        where: { action: 'user.nid_rejected', actorUserId: alice.id },
      });
      expect(audit).not.toBeNull();

      // A REJECTED user may resubmit with a different, verifiable NID.
      const retried = await submitNid(alice, VERIFIABLE_NID).expect(201);
      expect(retried.body.data.verificationStatus).toBe('VERIFIED');
    });

    it('rejects a malformed NID before any verification logic runs', async () => {
      const alice = await registerUser('alice@example.com');
      const res = await submitNid(alice, '123').expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('is idempotent when the already-verified user resubmits the same NID', async () => {
      const alice = await registerUser('alice@example.com');
      const first = await submitNid(alice, VERIFIABLE_NID).expect(201);
      const replay = await submitNid(alice, VERIFIABLE_NID).expect(201);
      expect(replay.body.data).toEqual(first.body.data);
    });

    it('refuses to re-verify an already-verified account with a different NID', async () => {
      const alice = await registerUser('alice@example.com');
      await submitNid(alice, VERIFIABLE_NID).expect(201);

      const res = await submitNid(alice, '9876543210').expect(409);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('refuses to let a second account claim an NID already used by another', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');

      await submitNid(alice, VERIFIABLE_NID).expect(201);

      const res = await submitNid(bob, VERIFIABLE_NID).expect(409);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      const bobStatus = await request(server())
        .get('/api/v1/users/me')
        .set('Cookie', bob.cookie)
        .expect(200);
      expect(bobStatus.body.data.verificationStatus).toBe('UNVERIFIED');
    });
  });

  describe('fraud/risk engine', () => {
    it('flags a HIGH-risk transfer, records it in the audit trail, and still lets the transfer succeed', async () => {
      const alice = await registerUser('alice@example.com'); // brand-new, unverified sender
      const bob = await registerUser('bob@example.com'); // brand-new receiver
      await setBalance(alice.id, 100_000n);

      // 90% of balance from a brand-new, unverified sender to a brand-new
      // receiver: LARGE_RELATIVE_TO_BALANCE + NEW_SENDER_ACCOUNT +
      // UNVERIFIED_SENDER + NEW_RECEIVER_ACCOUNT = 25+15+15+10 = 65 -> HIGH.
      const transfer = await sendTransfer(alice, {
        receiverUserId: bob.id,
        amountMinor: 90_000,
      }).expect(201);
      expect(transfer.body.data.status).toBe('SUCCEEDED');
      const transferId = transfer.body.data.transferId as string;

      // The receipt itself carries the assessment.
      expect(transfer.body.data.risk).toMatchObject({ level: 'HIGH' });
      expect(transfer.body.data.risk.score).toBeGreaterThanOrEqual(50);
      expect(transfer.body.data.risk.reasons).toEqual(
        expect.arrayContaining([
          "Amount is a large share of the sender's available balance.",
          'Sender account was created less than 24 hours ago.',
          'Sender has not completed NID verification.',
          'Receiver account was created less than 24 hours ago.',
        ]),
      );
      // No OPENAI_API_KEY is configured in this test environment, so the
      // optional explanation step must no-op rather than error or hang.
      expect(transfer.body.data.risk.explanation).toBeNull();

      // GET reflects the same, durable assessment.
      const fetched = await request(server())
        .get(`/api/v1/transfers/${transferId}`)
        .set('Cookie', alice.cookie)
        .expect(200);
      expect(fetched.body.data.risk).toMatchObject({ level: 'HIGH' });

      const audit = await prisma.auditEvent.findFirst({
        where: { action: 'transfer.risk_flagged', resourceId: transferId },
      });
      expect(audit).not.toBeNull();
      expect(audit!.metadata).toMatchObject({ level: 'HIGH' });

      // The money moved regardless — detection, not prevention.
      expect(
        (await prisma.wallet.findUniqueOrThrow({ where: { userId: bob.id } })).balanceMinor,
      ).toBe(10_090_000n);
    });

    it('records a LOW assessment with no reasons and no audit event for an unremarkable transfer', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await backdateAccount(alice.id, 10);
      await backdateAccount(bob.id, 10);
      await submitNid(alice, VERIFIABLE_NID).expect(201);

      // A small, non-round amount relative to a large balance.
      const transfer = await sendTransfer(alice, {
        receiverUserId: bob.id,
        amountMinor: 12_345,
      }).expect(201);
      const transferId = transfer.body.data.transferId as string;

      expect(transfer.body.data.risk).toEqual({
        score: 0,
        level: 'LOW',
        reasons: [],
        explanation: null,
      });

      const audit = await prisma.auditEvent.findFirst({
        where: { action: 'transfer.risk_flagged', resourceId: transferId },
      });
      expect(audit).toBeNull();

      // A LOW row still exists — every transfer is assessed, not just flagged ones.
      const assessment = await prisma.riskAssessment.findUnique({ where: { transferId } });
      expect(assessment).not.toBeNull();
      expect(assessment!.level).toBe('LOW');
    });

    it('does not expose a transfer or its risk assessment to a non-participant', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      const carol = await registerUser('carol@example.com');
      await setBalance(alice.id, 100_000n);

      const transfer = await sendTransfer(alice, {
        receiverUserId: bob.id,
        amountMinor: 90_000,
      }).expect(201);

      const res = await request(server())
        .get(`/api/v1/transfers/${transfer.body.data.transferId}`)
        .set('Cookie', carol.cookie)
        .expect(404);
      expect(res.body.error.code).toBe('TRANSFER_NOT_FOUND');
    });
  });
});
