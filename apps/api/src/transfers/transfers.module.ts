import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { TransfersController } from './transfers.controller';
import { TransfersRepository } from './transfers.repository';
import { TransferService } from './transfer.service';
import { TransferQueryService } from './transfer-query.service';

/**
 * Direct transfer core (Milestone 3). Owns all wallet balance movement;
 * money-requests will import this module and call TransferService on accept
 * rather than re-implementing debit/credit (AGENT.md §3).
 */
@Module({
  imports: [DatabaseModule, IdempotencyModule, OutboxModule],
  controllers: [TransfersController],
  providers: [TransferService, TransferQueryService, TransfersRepository],
  exports: [TransferService],
})
export class TransfersModule {}
