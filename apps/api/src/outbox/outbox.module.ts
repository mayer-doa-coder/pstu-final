import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NotificationsCoreModule } from '../notifications/notifications-core.module';
import { OutboxProcessor } from './outbox.processor';
import { OutboxRepository } from './outbox.repository';

/**
 * Outbox persistence plus the processor that drains it. The processor is
 * exported rather than started here — only WorkerModule registers the poller,
 * so the API process writes events but never consumes them.
 */
@Module({
  imports: [DatabaseModule, NotificationsCoreModule],
  providers: [OutboxRepository, OutboxProcessor],
  exports: [OutboxRepository, OutboxProcessor],
})
export class OutboxModule {}
