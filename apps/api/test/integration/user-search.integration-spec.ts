import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/database/prisma.service';
import { RedisService } from '../../src/redis/redis.service';

/**
 * End-to-end proof of recipient discovery (GET /users/search) against real
 * Postgres and Redis containers — including the rate limiter, which only
 * behaves correctly against a real Redis, not a mock.
 */
describe('User discovery (integration)', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let redisService: RedisService;

  beforeAll(async () => {
    [postgres, redis] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);

    process.env.DATABASE_URL = postgres.getConnectionUri();
    process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
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
    redisService = app.get(RedisService);
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await postgres.stop();
    await redis.stop();
  });

  beforeEach(async () => {
    await prisma.authSession.deleteMany();
    await prisma.wallet.deleteMany();
    await prisma.user.deleteMany();
  });

  function server(): ReturnType<INestApplication['getHttpServer']> {
    return app.getHttpServer();
  }

  async function registerAndAuthenticate(
    email: string,
    displayName: string,
  ): Promise<{ userId: string; cookie: string }> {
    const csrfRes = await request(server()).get('/api/v1/auth/csrf').expect(200);
    const csrfToken = csrfRes.body.data.csrfToken as string;

    const registerRes = await request(server())
      .post('/api/v1/auth/register')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ email, password: 'correct horse battery staple', displayName })
      .expect(201);

    const setCookie = registerRes.headers['set-cookie'] as unknown as string[];
    const accessCookie = setCookie.find((c) => c.startsWith('access_token='))!.split(';')[0]!;

    return { userId: registerRes.body.data.user.id as string, cookie: accessCookie };
  }

  function search(cookie: string | undefined, qs: string): request.Test {
    const req = request(server()).get(`/api/v1/users/search${qs}`);
    return cookie ? req.set('Cookie', cookie) : req;
  }

  it('rejects an unauthenticated search', async () => {
    const res = await search(undefined, '?q=nabila');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('finds an active user by exact, case-insensitive email', async () => {
    const me = await registerAndAuthenticate('me@example.com', 'Me Myself');
    await registerAndAuthenticate('nabila@example.com', 'Nabila Islam');

    const res = await search(me.cookie, '?q=NABILA@EXAMPLE.COM').expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ displayName: 'Nabila Islam', maskedEmail: 'n***@example.com' });
  });

  it('finds active users by partial display name and excludes the caller and non-matching users', async () => {
    const me = await registerAndAuthenticate('me2@example.com', 'Selfie Searcher');
    await registerAndAuthenticate('nabila@example.com', 'Nabila Islam');
    await registerAndAuthenticate('nabil@example.com', 'Nabil Rahman');
    await registerAndAuthenticate('tanvir@example.com', 'Tanvir Hasan');

    const res = await search(me.cookie, '?q=Nabi').expect(200);

    const names = res.body.data.map((row: { displayName: string }) => row.displayName).sort();
    expect(names).toEqual(['Nabil Rahman', 'Nabila Islam']);
  });

  it('never returns the caller even when their own name matches the query', async () => {
    const me = await registerAndAuthenticate('selfmatch@example.com', 'Selfie Searcher');

    const res = await search(me.cookie, '?q=Selfie').expect(200);

    expect(res.body.data).toEqual([]);
    expect(res.body.meta.nextCursor).toBeNull();
  });

  it('excludes suspended and closed users from results', async () => {
    const me = await registerAndAuthenticate('me3@example.com', 'Me Three');
    await registerAndAuthenticate('susan@example.com', 'Susan Suspended');
    await registerAndAuthenticate('closed@example.com', 'Closed Carl');

    await prisma.user.update({ where: { email: 'susan@example.com' }, data: { status: 'SUSPENDED' } });
    await prisma.user.update({ where: { email: 'closed@example.com' }, data: { status: 'CLOSED' } });

    const susanRes = await search(me.cookie, '?q=Susan').expect(200);
    const carlRes = await search(me.cookie, '?q=Carl').expect(200);

    expect(susanRes.body.data).toEqual([]);
    expect(carlRes.body.data).toEqual([]);
  });

  it('never exposes sensitive/internal fields or wallet balance', async () => {
    const me = await registerAndAuthenticate('me4@example.com', 'Me Four');
    await registerAndAuthenticate('exposed@example.com', 'Exposed Target');

    const res = await search(me.cookie, '?q=Exposed').expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['displayName', 'id', 'maskedEmail']);
    expect(res.body.data[0].maskedEmail).not.toBe('exposed@example.com');
    expect(JSON.stringify(res.body.data[0])).not.toMatch(/passwordHash|balanceMinor|status|refreshToken/i);
  });

  it('returns an empty page for a query that matches nobody', async () => {
    const me = await registerAndAuthenticate('me5@example.com', 'Me Five');

    const res = await search(me.cookie, '?q=zzzznonexistent').expect(200);

    expect(res.body.data).toEqual([]);
    expect(res.body.meta.nextCursor).toBeNull();
  });

  it('paginates results with a cursor and stops with nextCursor: null on the last page', async () => {
    const me = await registerAndAuthenticate('me6@example.com', 'Me Six');
    await registerAndAuthenticate('pagea@example.com', 'PageUser A');
    await registerAndAuthenticate('pageb@example.com', 'PageUser B');
    await registerAndAuthenticate('pagec@example.com', 'PageUser C');

    const firstPage = await search(me.cookie, '?q=PageUser&limit=2').expect(200);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.meta.nextCursor).not.toBeNull();

    const cursor = encodeURIComponent(firstPage.body.meta.nextCursor as string);
    const secondPage = await search(me.cookie, `?q=PageUser&limit=2&cursor=${cursor}`).expect(200);
    expect(secondPage.body.data).toHaveLength(1);
    expect(secondPage.body.meta.nextCursor).toBeNull();

    const allNames = [...firstPage.body.data, ...secondPage.body.data].map(
      (row: { displayName: string }) => row.displayName,
    );
    expect(new Set(allNames)).toEqual(new Set(['PageUser A', 'PageUser B', 'PageUser C']));
  });

  it('rejects a limit above the bounded page size', async () => {
    const me = await registerAndAuthenticate('me7@example.com', 'Me Seven');

    const res = await search(me.cookie, '?q=anything&limit=999');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a query shorter than the minimum length', async () => {
    const me = await registerAndAuthenticate('me8@example.com', 'Me Eight');

    const res = await search(me.cookie, '?q=a');

    expect(res.status).toBe(400);
  });

  it('rate-limits repeated search requests from the same user', async () => {
    const me = await registerAndAuthenticate('me9@example.com', 'Me Nine');
    await redisService.incrementWithExpiry('reset-marker', 1); // sanity: Redis is reachable

    const RATE_LIMIT = 30;
    const responses: number[] = [];
    // Sequential on purpose — the fixed window must be exercised in a
    // deterministic order to reliably observe the 31st request tip over it.
    for (let i = 0; i < RATE_LIMIT + 1; i += 1) {
      const res = await search(me.cookie, '?q=nonexistentquery');
      responses.push(res.status);
    }

    expect(responses.slice(0, RATE_LIMIT).every((status) => status === 200)).toBe(true);
    expect(responses.at(-1)).toBe(429);
  }, 30_000);
});
