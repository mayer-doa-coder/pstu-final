import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { AuditModule } from './audit/audit.module';
import { DatabaseModule } from './database/database.module';
import { OutboxModule } from './outbox/outbox.module';
import { OutboxPoller } from './outbox/outbox.poller';

/**
 * Root module for the background worker process. Runs the same codebase and
 * domain providers as the API (see ADR-001) but boots without an HTTP
 * listener, and is the only process that registers OutboxPoller — so
 * event dispatch never runs on an API request's critical path.
 */
@Module({
  imports: [AppConfigModule, DatabaseModule, AuditModule, OutboxModule],
  providers: [OutboxPoller],
})
export class WorkerModule {}
