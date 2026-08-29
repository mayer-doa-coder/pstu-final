import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { TransfersModule } from '../transfers/transfers.module';
import { UsersModule } from '../users/users.module';
import { MoneyRequestQueryService } from './money-request-query.service';
import { MoneyRequestService } from './money-request.service';
import { MoneyRequestsController } from './money-requests.controller';
import { MoneyRequestsRepository } from './money-requests.repository';

/**
 * Request lifecycle (create/accept/decline/cancel). Imports TransfersModule
 * and calls TransferService on accept rather than re-implementing
 * debit/credit (AGENT.md §3).
 */
@Module({
  imports: [DatabaseModule, IdempotencyModule, OutboxModule, TransfersModule, UsersModule],
  controllers: [MoneyRequestsController],
  providers: [MoneyRequestService, MoneyRequestQueryService, MoneyRequestsRepository],
})
export class MoneyRequestsModule {}
