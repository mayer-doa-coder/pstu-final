import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/database/prisma.service';

/**
 * End-to-end proof of the auth/user/wallet foundation against a real
 * Postgres container and the app's real HTTP pipeline (bootstrap.ts) — not
 * mocks. Covers registration atomicity, login, refresh rotation/reuse
 * detection, logout, CSRF, and wallet authorization.
 */
describe('Auth + User + Wallet (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;

  const testUser = {
    email: 'rahim@example.com',
    password: 'correct horse battery staple',
    displayName: 'Rahim',
  };

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

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    await prisma.authSession.deleteMany();
    await prisma.wallet.deleteMany();
    await prisma.user.deleteMany();
  });

  function server(): ReturnType<INestApplication['getHttpServer']> {
    return app.getHttpServer();
  }

  async function fetchCsrf(): Promise<{ token: string; cookie: string }> {
    const res = await request(server()).get('/api/v1/auth/csrf').expect(200);
    const token = res.body.data.csrfToken as string;
    return { token, cookie: `csrf_token=${token}` };
  }

  function cookieValue(res: request.Response, name: string): string {
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    const raw = setCookie?.find((entry) => entry.startsWith(`${name}=`));
    if (!raw) {
      throw new Error(`Cookie "${name}" was not set on the response`);
    }
    return raw.split(';')[0]!.slice(name.length + 1);
  }

  async function registerTestUser(): Promise<request.Response> {
    const { token, cookie } = await fetchCsrf();
    return request(server())
      .post('/api/v1/auth/register')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send(testUser);
  }

  /** Asserts the response was a successful registration and returns it, so call sites stay a one-liner. */
  function expectRegistered(res: request.Response): request.Response {
    expect(res.status).toBe(201);
    return res;
  }

  describe('registration', () => {
    it('creates the user and wallet atomically with the configured seed balance', async () => {
      const res = expectRegistered(await registerTestUser());

      expect(res.body.data.user).toMatchObject({
        email: testUser.email,
        displayName: testUser.displayName,
        status: 'ACTIVE',
      });
      expect(res.body.data.wallet).toMatchObject({
        currency: 'BDT',
        status: 'ACTIVE',
        balanceMinor: 10_000_000,
      });
      expect(res.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringContaining('access_token='), expect.stringContaining('refresh_token=')]),
      );

      const storedUser = await prisma.user.findUniqueOrThrow({ where: { email: testUser.email } });
      const storedWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: storedUser.id } });
      expect(storedWallet.balanceMinor).toBe(10_000_000n);
    });

    it('stores the password hashed, never in plain text', async () => {
      expectRegistered(await registerTestUser());

      const stored = await prisma.user.findUniqueOrThrow({ where: { email: testUser.email } });
      expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
      expect(stored.passwordHash).not.toContain(testUser.password);
    });

    it('rejects a duplicate email, case-insensitively', async () => {
      expectRegistered(await registerTestUser());

      const { token, cookie } = await fetchCsrf();
      const duplicate = await request(server())
        .post('/api/v1/auth/register')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', token)
        .send({ ...testUser, email: testUser.email.toUpperCase() });

      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('VALIDATION_ERROR');
      await expect(prisma.user.count()).resolves.toBe(1);
    });

    it('creates exactly one user+wallet pair when the same email registers concurrently', async () => {
      const [first, second] = await Promise.all([registerTestUser(), registerTestUser()]);

      const statuses = [first.status, second.status].sort((a, b) => a - b);
      expect(statuses).toEqual([201, 409]);

      const users = await prisma.user.findMany({ where: { email: testUser.email } });
      expect(users).toHaveLength(1);
      const wallets = await prisma.wallet.findMany({ where: { userId: users[0]!.id } });
      expect(wallets).toHaveLength(1);
    });
  });

  describe('login', () => {
    it('succeeds with correct credentials and fails identically for wrong password vs. unknown email', async () => {
      expectRegistered(await registerTestUser());

      const good = await fetchCsrf();
      const goodLogin = await request(server())
        .post('/api/v1/auth/login')
        .set('Cookie', good.cookie)
        .set('X-CSRF-Token', good.token)
        .send({ email: testUser.email, password: testUser.password });
      expect(goodLogin.status).toBe(200);
      expect(goodLogin.body.data.user.email).toBe(testUser.email);

      const wrongPw = await fetchCsrf();
      const wrongPassword = await request(server())
        .post('/api/v1/auth/login')
        .set('Cookie', wrongPw.cookie)
        .set('X-CSRF-Token', wrongPw.token)
        .send({ email: testUser.email, password: 'incorrect-password' });
      expect(wrongPassword.status).toBe(401);

      const unknown = await fetchCsrf();
      const unknownEmail = await request(server())
        .post('/api/v1/auth/login')
        .set('Cookie', unknown.cookie)
        .set('X-CSRF-Token', unknown.token)
        .send({ email: 'nobody@example.com', password: 'whatever-12345' });
      expect(unknownEmail.status).toBe(401);

      // Identical error shape for both — no account-existence leak.
      expect(unknownEmail.body.error.code).toBe(wrongPassword.body.error.code);
      expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
    });

    it.each(['SUSPENDED', 'CLOSED'] as const)('rejects login for a %s account', async (status) => {
      expectRegistered(await registerTestUser());
      await prisma.user.update({ where: { email: testUser.email }, data: { status } });

      const { token, cookie } = await fetchCsrf();
      const res = await request(server())
        .post('/api/v1/auth/login')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', token)
        .send({ email: testUser.email, password: testUser.password });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token so the old one is rejected — and revokes the whole session on reuse', async () => {
      const registerRes = expectRegistered(await registerTestUser());
      const { token: csrfToken, cookie: csrfCookie } = await fetchCsrf();
      const firstRefresh = cookieValue(registerRes, 'refresh_token');

      const refreshRes = await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${csrfCookie}; refresh_token=${firstRefresh}`)
        .set('X-CSRF-Token', csrfToken)
        .send()
        .expect(200);
      const secondRefresh = cookieValue(refreshRes, 'refresh_token');
      expect(secondRefresh).not.toBe(firstRefresh);

      // Reusing the now-rotated (revoked) first token must fail...
      const reuseRes = await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${csrfCookie}; refresh_token=${firstRefresh}`)
        .set('X-CSRF-Token', csrfToken)
        .send();
      expect(reuseRes.status).toBe(401);

      // ...and, because reuse looks like token theft, the *current* valid
      // token is revoked too, not just the stale one.
      const secondAttemptRes = await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${csrfCookie}; refresh_token=${secondRefresh}`)
        .set('X-CSRF-Token', csrfToken)
        .send();
      expect(secondAttemptRes.status).toBe(401);
    });

    it('rejects an unknown refresh token', async () => {
      const { token, cookie } = await fetchCsrf();
      const res = await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${cookie}; refresh_token=not-a-real-token`)
        .set('X-CSRF-Token', token)
        .send();
      expect(res.status).toBe(401);
    });
  });

  describe('logout', () => {
    it('revokes the session so a subsequent refresh fails', async () => {
      const registerRes = expectRegistered(await registerTestUser());
      const { token: csrfToken, cookie: csrfCookie } = await fetchCsrf();
      const refreshToken = cookieValue(registerRes, 'refresh_token');

      await request(server())
        .post('/api/v1/auth/logout')
        .set('Cookie', `${csrfCookie}; refresh_token=${refreshToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send()
        .expect(200);

      const refreshAfterLogout = await request(server())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${csrfCookie}; refresh_token=${refreshToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send();
      expect(refreshAfterLogout.status).toBe(401);
    });
  });

  describe('CSRF protection', () => {
    it('rejects a state-changing request with no CSRF token at all', async () => {
      const res = await request(server()).post('/api/v1/auth/register').send(testUser);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects a request whose header does not match its CSRF cookie', async () => {
      const { cookie } = await fetchCsrf();
      const res = await request(server())
        .post('/api/v1/auth/register')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', 'mismatched-token')
        .send(testUser);
      expect(res.status).toBe(403);
    });

    it('accepts a request whose header matches its CSRF cookie', async () => {
      const { token, cookie } = await fetchCsrf();
      const res = await request(server())
        .post('/api/v1/auth/register')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', token)
        .send(testUser);
      expect(res.status).toBe(201);
    });
  });

  describe('GET /wallet', () => {
    it('returns the authenticated caller wallet only', async () => {
      const { token, cookie } = await fetchCsrf();
      const agentCookies = [cookie];

      const registerRes = await request(server())
        .post('/api/v1/auth/register')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', token)
        .send(testUser)
        .expect(201);

      const accessToken = cookieValue(registerRes, 'access_token');
      agentCookies.push(`access_token=${accessToken}`);

      const walletRes = await request(server())
        .get('/api/v1/wallet')
        .set('Cookie', agentCookies.join('; '))
        .expect(200);

      expect(walletRes.body.data).toMatchObject({ currency: 'BDT', status: 'ACTIVE', balanceMinor: 10_000_000 });
    });

    it('rejects an unauthenticated wallet lookup', async () => {
      const res = await request(server()).get('/api/v1/wallet');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('database invariants', () => {
    it('rejects a negative wallet balance at the database level (no app endpoint can attempt this)', async () => {
      const registerRes = expectRegistered(await registerTestUser());
      const walletId = registerRes.body.data.wallet.walletId as string;

      await expect(
        prisma.$executeRaw`UPDATE wallets SET balance_minor = -1 WHERE id = ${walletId}::uuid`,
      ).rejects.toThrow();
    });
  });
});
