import { Module } from '@nestjs/common';
import { OutboxRepository } from './outbox.repository';

/**
 * Outbox persistence only. The event consumer (BullMQ worker, notifications)
 * lands in Milestone 6 — see IMPLEMENTATION_GUIDE.md §4.
 */
@Module({
  providers: [OutboxRepository],
  exports: [OutboxRepository],
})
export class OutboxModule {}
