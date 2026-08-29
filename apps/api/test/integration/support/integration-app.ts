import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import Redis from 'ioredis';
import { configureApp } from '../../../src/bootstrap';
import type { AppConfigService } from '../../../src/config/app-config.service';
import { PrismaService } from '../../../src/database/prisma.service';
import { RedisService } from '../../../src/redis/redis.service';

/** Every table, ordered so one CASCADE truncate clears the FK cycles too. */
const ALL_TABLES = [
  'notifications',
  'audit_events',
  'risk_assessments',
  'ledger_entries',
  'outbox_events',
  'transfers',
  'money_requests',
  'idempotency_records',
  'auth_sessions',
  'wallets',
  'users',
].join(', ');

export interface IntegrationApp {
  app: INestApplication;
  prisma: PrismaService;
  /** Truncate every table and clear rate-limit counters. Call in `beforeEach`. */
  reset(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Boots the real app against throwaway Postgres and Redis containers, with the
 * real HTTP pipeline from `bootstrap.ts`.
 *
 * Redis gets its own container per suite, and `reset()` flushes it: rate
 * limits are keyed by client IP, and every request from a test arrives from
 * the same loopback address, so a shared Redis would let one spec's
 * registrations exhaust another's budget.
 *
 * Redis is injected by overriding the provider rather than by setting
 * `REDIS_URL`, because AppConfigModule validates and freezes the environment
 * when it is imported — which happens before any `beforeAll` hook runs.
 */
export async function startIntegrationApp(): Promise<IntegrationApp> {
  const postgres: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:16-alpine',
  ).start();
  const redisContainer: StartedRedisContainer = await new RedisContainer('redis:7-alpine').start();
  const redis = new Redis(redisContainer.getConnectionUrl());

  process.env.DATABASE_URL = postgres.getConnectionUri();
  process.env.JWT_ACCESS_SECRET = 'integration-test-secret-at-least-32-characters-long';
  process.env.NODE_ENV = 'test';

  const repoRoot = path.resolve(__dirname, '../../../../..');
  const schemaPath = path.join(repoRoot, 'database', 'prisma', 'schema.prisma');
  const prismaCliEntry = path.join(repoRoot, 'node_modules', 'prisma', 'build', 'index.js');

  execFileSync(process.execPath, [prismaCliEntry, 'migrate', 'deploy', '--schema', schemaPath], {
    env: process.env,
    stdio: 'pipe',
  });

  // Imported here, not at module top level, so the migration above has already
  // run and DATABASE_URL is set before Nest builds the DI graph.
  const { AppModule } = await import('../../../src/app.module');
  const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RedisService)
    .useValue(
      new RedisService({
        redisUrl: redisContainer.getConnectionUrl(),
      } as unknown as AppConfigService),
    )
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);

  return {
    app,
    prisma,
    async reset(): Promise<void> {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${ALL_TABLES} RESTART IDENTITY CASCADE`);
      await redis.flushall();
    },
    async stop(): Promise<void> {
      await app.close();
      redis.disconnect();
      await redisContainer.stop();
      await postgres.stop();
    },
  };
}
