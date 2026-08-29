import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { LimitsModule } from '../limits/limits.module';
import { OutboxModule } from '../outbox/outbox.module';
import { RiskModule } from '../risk/risk.module';
import { TransfersController } from './transfers.controller';
import { TransfersRepository } from './transfers.repository';
import { TransferService } from './transfer.service';
import { TransferQueryService } from './transfer-query.service';

/**
 * Direct transfer core (Milestone 3). Owns all wallet balance movement;
 * money-requests will import this module and call TransferService on accept
 * rather than re-implementing debit/credit (AGENT.md §3). Also the only
 * place the risk engine and the per-user send limits run — every settled
 * transfer is scored and limit-checked here, regardless of which
 * higher-level flow (direct send or request accept) produced it.
 */
@Module({
  imports: [DatabaseModule, IdempotencyModule, OutboxModule, RiskModule, LimitsModule],
  controllers: [TransfersController],
  providers: [TransferService, TransferQueryService, TransfersRepository],
  exports: [TransferService],
})
export class TransfersModule {}
