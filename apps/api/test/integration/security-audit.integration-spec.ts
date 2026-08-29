import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../../src/database/prisma.service';
import { type IntegrationApp, startIntegrationApp } from './support/integration-app';

const PASSWORD = 'correct horse battery staple';

/**
 * Security-hardening and audit proofs. Covers the authorization boundaries
 * from PRD.md §7 (AC-5), CSRF/headers/limits, and the audit trail that lets a
 * developer investigate an action by actor, resource, or correlation id.
 */
describe('Security hardening and audit (integration)', () => {
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

  async function csrf(): Promise<string> {
    const res = await request(server()).get('/api/v1/auth/csrf').expect(200);
    return res.body.data.csrfToken as string;
  }

  async function registerUser(email: string): Promise<TestUser> {
    const csrfToken = await csrf();
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

  describe('authentication enforcement', () => {
    it.each([
      ['/api/v1/wallet'],
      ['/api/v1/activity'],
      ['/api/v1/notifications'],
      ['/api/v1/money-requests/incoming'],
      ['/api/v1/users/me'],
    ])('rejects an unauthenticated GET %s', async (route) => {
      const res = await request(server()).get(route).expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a forged access token', async () => {
      const res = await request(server())
        .get('/api/v1/wallet')
        .set('Cookie', 'access_token=not.a.real.jwt')
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('account status enforcement', () => {
    it('blocks a still-valid token once the account is suspended, and audits it', async () => {
      const alice = await registerUser('alice@example.com');
      await request(server()).get('/api/v1/wallet').set('Cookie', alice.cookie).expect(200);

      // The token stays cryptographically valid; only the account changed.
      await prisma.user.update({ where: { id: alice.id }, data: { status: 'SUSPENDED' } });

      const blocked = await request(server())
        .get('/api/v1/wallet')
        .set('Cookie', alice.cookie)
        .expect(403);
      expect(blocked.body.error.code).toBe('FORBIDDEN');

      const audit = await prisma.auditEvent.findFirst({
        where: { action: 'auth.account_blocked', actorUserId: alice.id },
      });
      expect(audit).not.toBeNull();
      expect(audit!.metadata).toMatchObject({ status: 'SUSPENDED' });
    });

    it('stops a suspended account from moving money', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);
      await prisma.user.update({ where: { id: alice.id }, data: { status: 'SUSPENDED' } });

      await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 1_000 }).expect(403);

      expect(await prisma.transfer.count()).toBe(0);
      expect(
        (await prisma.wallet.findUniqueOrThrow({ where: { userId: alice.id } })).balanceMinor,
      ).toBe(100_000n);
    });

    it('refuses login for a closed account', async () => {
      const carol = await registerUser('carol@example.com');
      await prisma.user.update({ where: { id: carol.id }, data: { status: 'CLOSED' } });

      const token = await csrf();
      const res = await request(server())
        .post('/api/v1/auth/login')
        .set('Cookie', `csrf_token=${token}`)
        .set('X-CSRF-Token', token)
        .send({ email: carol.email, password: PASSWORD })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('authorization boundaries', () => {
    it('keeps transfers, requests, and wallets private to their participants', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      const carol = await registerUser('carol@example.com');
      await setBalance(alice.id, 100_000n);
      await setBalance(bob.id, 50_000n);

      const transfer = await sendTransfer(alice, {
        receiverUserId: bob.id,
        amountMinor: 10_000,
      }).expect(201);
      const created = await request(server())
        .post('/api/v1/money-requests')
        .set('Cookie', alice.cookie)
        .set('X-CSRF-Token', alice.csrfToken)
        .set('Idempotency-Key', randomUUID())
        .send({ payerUserId: bob.id, amountMinor: 5_000 })
        .expect(201);

      const transferId = transfer.body.data.transferId as string;
      const requestId = created.body.data.requestId as string;

      // Reads.
      await request(server())
        .get(`/api/v1/transfers/${transferId}`)
        .set('Cookie', carol.cookie)
        .expect(404);
      await request(server())
        .get(`/api/v1/money-requests/${requestId}`)
        .set('Cookie', carol.cookie)
        .expect(404);

      // Mutations by a non-participant.
      for (const action of ['accept', 'decline', 'cancel'] as const) {
        const res = await request(server())
          .post(`/api/v1/money-requests/${requestId}/${action}`)
          .set('Cookie', carol.cookie)
          .set('X-CSRF-Token', carol.csrfToken)
          .set('Idempotency-Key', randomUUID())
          .send({})
          .expect(404);
        expect(res.body.error.code).toBe('MONEY_REQUEST_NOT_FOUND');
      }

      // A participant acting in the wrong role is refused too.
      const wrongRole = await request(server())
        .post(`/api/v1/money-requests/${requestId}/accept`)
        .set('Cookie', alice.cookie)
        .set('X-CSRF-Token', alice.csrfToken)
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(403);
      expect(wrongRole.body.error.code).toBe('FORBIDDEN');

      // The request is still untouched after every rejected attempt.
      expect(
        (await prisma.moneyRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
      ).toBe('PENDING');
    });

    it("exposes only the caller's own wallet balance, never another user's", async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 111_000n);
      await setBalance(bob.id, 222_000n);

      const wallet = await request(server())
        .get('/api/v1/wallet')
        .set('Cookie', alice.cookie)
        .expect(200);
      expect(wallet.body.data.balanceMinor).toBe(111_000);

      // Search is the only place another user surfaces; it must carry no balance.
      const search = await request(server())
        .get('/api/v1/users/search?q=bob')
        .set('Cookie', alice.cookie)
        .expect(200);
      const serialized = JSON.stringify(search.body);
      expect(serialized).not.toMatch(/balanceMinor|222000/);
      expect(serialized).not.toMatch(/passwordHash/);
      // Contact identifiers are masked, never returned in full.
      expect(serialized).not.toContain('bob@example.com');
    });

    it('derives the sender from the session, not the request body', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);
      await setBalance(bob.id, 100_000n);

      // A spoofed senderUserId in the body must be ignored entirely.
      const res = await sendTransfer(alice, {
        senderUserId: bob.id,
        receiverUserId: bob.id,
        amountMinor: 10_000,
      }).expect(201);

      expect(res.body.data.senderUserId).toBe(alice.id);
      const transfer = await prisma.transfer.findUniqueOrThrow({
        where: { id: res.body.data.transferId as string },
      });
      expect(transfer.senderUserId).toBe(alice.id);
    });
  });

  describe('CSRF, headers, and input limits', () => {
    it('rejects a cookie-authenticated mutation with a missing or mismatched CSRF token', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);

      const missing = await request(server())
        .post('/api/v1/transfers')
        .set('Cookie', alice.cookie)
        .set('Idempotency-Key', randomUUID())
        .send({ receiverUserId: bob.id, amountMinor: 1_000 })
        .expect(403);
      expect(missing.body.error.code).toBe('FORBIDDEN');

      const mismatched = await request(server())
        .post('/api/v1/transfers')
        .set('Cookie', alice.cookie)
        .set('X-CSRF-Token', 'a-token-the-attacker-guessed')
        .set('Idempotency-Key', randomUUID())
        .send({ receiverUserId: bob.id, amountMinor: 1_000 })
        .expect(403);
      expect(mismatched.body.error.code).toBe('FORBIDDEN');

      expect(await prisma.transfer.count()).toBe(0);
    });

    it('sets baseline security headers and marks auth cookies HttpOnly', async () => {
      const res = await request(server()).get('/api/v1/auth/csrf').expect(200);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-request-id']).toEqual(expect.any(String));

      // The CSRF cookie must stay readable by the SPA so it can be echoed
      // back in the X-CSRF-Token header — that is the double-submit check.
      const csrfCookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('csrf_token='),
      )!;
      expect(csrfCookie).not.toContain('HttpOnly');
      expect(csrfCookie).toContain('SameSite=Lax');

      const token = await csrf();
      const registered = await request(server())
        .post('/api/v1/auth/register')
        .set('Cookie', `csrf_token=${token}`)
        .set('X-CSRF-Token', token)
        .send({ email: 'headers@example.com', password: PASSWORD, displayName: 'headers' })
        .expect(201);

      // Session tokens, by contrast, must be unreadable from JavaScript.
      const cookies = registered.headers['set-cookie'] as unknown as string[];
      expect(cookies.find((c) => c.startsWith('access_token='))).toContain('HttpOnly');
      expect(cookies.find((c) => c.startsWith('refresh_token='))).toContain('HttpOnly');
    });

    it('rejects an oversized request body', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');

      const res = await request(server())
        .post('/api/v1/transfers')
        .set('Cookie', alice.cookie)
        .set('X-CSRF-Token', alice.csrfToken)
        .set('Idempotency-Key', randomUUID())
        .send({ receiverUserId: bob.id, amountMinor: 1_000, note: 'x'.repeat(200_000) });

      expect(res.status).toBe(413);
      // Rejected cleanly as client error, not surfaced as an internal fault.
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(await prisma.transfer.count()).toBe(0);
    });

    it('rejects control characters in stored user-controlled text', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);

      const res = await sendTransfer(alice, {
        receiverUserId: bob.id,
        amountMinor: 1_000,
        note: 'line one\u0000line two',
      }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('never leaks a stack trace or internal detail in an error response', async () => {
      const res = await request(server())
        .get('/api/v1/transfers/not-a-uuid')
        .set('Cookie', (await registerUser('alice@example.com')).cookie)
        .expect(404);

      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toMatch(/at .*\.ts:|node_modules|PrismaClient|SELECT /i);
      expect(res.body.error).toEqual({
        code: 'TRANSFER_NOT_FOUND',
        message: expect.any(String),
      });
      expect(res.body.requestId).toEqual(expect.any(String));
    });

    it('treats a SQL-injection payload as an ordinary search string', async () => {
      const alice = await registerUser('alice@example.com');
      await registerUser('bob@example.com');

      const res = await request(server())
        .get(`/api/v1/users/search?q=${encodeURIComponent("'; DROP TABLE users; --")}`)
        .set('Cookie', alice.cookie)
        .expect(200);

      expect(res.body.data).toEqual([]);
      // The table is intact — the input was parameterized, not interpolated.
      expect(await prisma.user.count()).toBe(2);
    });
  });

  describe('rate limiting', () => {
    it('throttles repeated failed logins from one client', async () => {
      const alice = await registerUser('alice@example.com');
      const token = await csrf();

      const attempt = (): request.Test =>
        request(server())
          .post('/api/v1/auth/login')
          .set('Cookie', `csrf_token=${token}`)
          .set('X-CSRF-Token', token)
          .send({ email: alice.email, password: 'wrong-password' });

      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        statuses.push((await attempt()).status);
      }

      // 10/minute budget: the first ten are ordinary auth failures, the rest
      // are refused before credentials are even checked.
      expect(statuses.filter((s) => s === 401)).toHaveLength(10);
      expect(statuses.filter((s) => s === 429)).toHaveLength(2);

      const limited = await attempt().expect(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
    });
  });

  describe('audit trail', () => {
    it('records a successful transfer with its correlation id, and no sensitive payload', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 100_000n);

      const correlationId = randomUUID();
      const res = await request(server())
        .post('/api/v1/transfers')
        .set('Cookie', alice.cookie)
        .set('X-CSRF-Token', alice.csrfToken)
        .set('Idempotency-Key', randomUUID())
        .set('X-Request-Id', correlationId)
        .send({ receiverUserId: bob.id, amountMinor: 20_000, note: 'private dinner note' })
        .expect(201);

      expect(res.headers['x-request-id']).toBe(correlationId);
      const transferId = res.body.data.transferId as string;

      // Investigable by resource id...
      const byResource = await prisma.auditEvent.findFirstOrThrow({
        where: { resourceType: 'transfer', resourceId: transferId },
      });
      expect(byResource).toMatchObject({
        action: 'transfer.succeeded',
        actorUserId: alice.id,
        requestId: correlationId,
      });
      expect(byResource.metadata).toMatchObject({
        receiverUserId: bob.id,
        amountMinor: '20000',
        currency: 'BDT',
      });

      // ...and by correlation id.
      const byRequest = await prisma.auditEvent.findMany({ where: { requestId: correlationId } });
      expect(byRequest.length).toBeGreaterThan(0);

      // The user's free-text note is never copied into the audit trail.
      expect(JSON.stringify(byResource.metadata)).not.toContain('private dinner note');
    });

    it('records a rejected transfer even though its transaction rolled back', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(alice.id, 1_000n);

      await sendTransfer(alice, { receiverUserId: bob.id, amountMinor: 500_000 }).expect(409);

      const failure = await prisma.auditEvent.findFirstOrThrow({
        where: { action: 'transfer.failed', actorUserId: alice.id },
      });
      expect(failure.metadata).toMatchObject({ reason: 'INSUFFICIENT_BALANCE' });
      expect(await prisma.transfer.count()).toBe(0);
    });

    it('records the money-request lifecycle', async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      await setBalance(bob.id, 100_000n);

      const created = await request(server())
        .post('/api/v1/money-requests')
        .set('Cookie', alice.cookie)
        .set('X-CSRF-Token', alice.csrfToken)
        .set('Idempotency-Key', randomUUID())
        .send({ payerUserId: bob.id, amountMinor: 15_000 })
        .expect(201);
      const requestId = created.body.data.requestId as string;

      await request(server())
        .post(`/api/v1/money-requests/${requestId}/accept`)
        .set('Cookie', bob.cookie)
        .set('X-CSRF-Token', bob.csrfToken)
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(200);

      const actions = (
        await prisma.auditEvent.findMany({
          where: { resourceType: 'money_request', resourceId: requestId },
        })
      ).map((e) => e.action);

      expect(actions).toContain('money_request.created');
      expect(actions).toContain('money_request.accepted');
    });

    it('audits auth events without persisting any credential material', async () => {
      const alice = await registerUser('alice@example.com');
      const token = await csrf();

      await request(server())
        .post('/api/v1/auth/login')
        .set('Cookie', `csrf_token=${token}`)
        .set('X-CSRF-Token', token)
        .send({ email: alice.email, password: 'wrong-password' })
        .expect(401);

      const login = await request(server())
        .post('/api/v1/auth/login')
        .set('Cookie', `csrf_token=${token}`)
        .set('X-CSRF-Token', token)
        .send({ email: alice.email, password: PASSWORD })
        .expect(200);

      const actions = (await prisma.auditEvent.findMany({ where: { actorUserId: alice.id } })).map(
        (e) => e.action,
      );
      expect(actions).toContain('user.registered');
      expect(actions).toContain('auth.login_failed');
      expect(actions).toContain('auth.login_succeeded');

      // Nothing secret reaches the audit trail: not the password, not the
      // CSRF token, not the issued session tokens or their hashes.
      const refreshToken = cookieValue(login, 'refresh_token');
      const accessToken = cookieValue(login, 'access_token');
      const dump = JSON.stringify(await prisma.auditEvent.findMany());
      for (const secret of [PASSWORD, token, refreshToken, accessToken]) {
        expect(dump).not.toContain(secret);
      }
      expect(dump).not.toMatch(/\$argon2/);

      // The session row stores only a hash of the refresh token, never the token.
      const sessions = await prisma.authSession.findMany();
      expect(sessions.length).toBeGreaterThan(0);
      for (const session of sessions) {
        expect(session.refreshTokenHash).not.toBe(refreshToken);
      }
    });

    it('revokes every session when a revoked refresh token is replayed', async () => {
      const token = await csrf();
      const registered = await request(server())
        .post('/api/v1/auth/register')
        .set('Cookie', `csrf_token=${token}`)
        .set('X-CSRF-Token', token)
        .send({ email: 'replay@example.com', password: PASSWORD, displayName: 'replay' })
        .expect(201);

      const stolen = cookieValue(registered, 'refresh_token');
      const refreshCookie = `csrf_token=${token}; refresh_token=${stolen}`;

      // First use rotates the token, revoking the presented one.
      await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie)
        .set('X-CSRF-Token', token)
        .send({})
        .expect(200);

      // Replaying the now-revoked token is treated as theft.
      await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie)
        .set('X-CSRF-Token', token)
        .send({})
        .expect(401);

      const active = await prisma.authSession.count({ where: { revokedAt: null } });
      expect(active).toBe(0);

      const audit = await prisma.auditEvent.findFirst({
        where: { action: 'auth.refresh_reuse_detected' },
      });
      expect(audit).not.toBeNull();
    });
  });
});
