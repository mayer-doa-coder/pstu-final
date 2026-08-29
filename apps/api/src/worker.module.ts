import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';

/**
 * Root module for the background worker process. Runs the same codebase and
 * domain providers as the API (see ADR-001) but boots without an HTTP
 * listener. BullMQ processors that consume `outbox_events` are added here in
 * Milestone 6 — see IMPLEMENTATION_GUIDE.md §4, Milestone 6.
 */
@Module({
  imports: [AppConfigModule, DatabaseModule],
})
export class WorkerModule {}
