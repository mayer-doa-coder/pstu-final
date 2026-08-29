// Minimal env so ConfigModule's validateEnv passes during module construction.
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/db?schema=public';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET ||= 'test-secret-at-least-32-characters-long-xx';

import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { WorkerModule } from './worker.module';

/**
 * Boots each process's dependency-injection graph (without lifecycle hooks, so
 * no real DB/Redis connection and no poller timer) to catch wiring mistakes —
 * missing module imports, unresolvable providers — that otherwise only surface
 * at container startup.
 */
describe('module wiring', () => {
  it('resolves every provider in the API DI graph', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.close();
  });

  it('resolves every provider in the worker DI graph', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await moduleRef.close();
  });
});
