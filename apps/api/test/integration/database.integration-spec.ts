import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';

/**
 * Proves the real migration/connectivity pipeline end-to-end against an
 * ephemeral Postgres container — not a mock. Per project rule, Testcontainers
 * runs from this host/CI test process; the api/worker Docker images never
 * get a Docker socket themselves.
 */
describe('database migration pipeline (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  const repoRoot = path.resolve(__dirname, '../../../..');
  const schemaPath = path.join(repoRoot, 'database', 'prisma', 'schema.prisma');
  const prismaCliEntry = path.join(repoRoot, 'node_modules', 'prisma', 'build', 'index.js');

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
  }, 60_000);

  afterAll(async () => {
    await container.stop();
  });

  it('applies migrations and connects successfully against a fresh database', async () => {
    const databaseUrl = container.getConnectionUri();

    execFileSync(process.execPath, [prismaCliEntry, 'migrate', 'deploy', '--schema', schemaPath], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });

    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

    try {
      const result = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
      expect(result).toEqual([{ ok: 1 }]);

      const userCount = await prisma.user.count();
      expect(userCount).toBe(0);
    } finally {
      await prisma.$disconnect();
    }
  });
});
