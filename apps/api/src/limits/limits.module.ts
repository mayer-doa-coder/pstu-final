import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TransactionLimitRepository } from './transaction-limit.repository';
import { TransactionLimitService } from './transaction-limit.service';

/**
 * Per-user daily/weekly/monthly send limits. Imported by TransfersModule (to
 * enforce a limit as a transfer settles) and WalletsModule (to show current
 * usage on `GET /wallet`) — no controller, no table of its own: everything is
 * derived from `transfers`.
 */
@Module({
  imports: [DatabaseModule],
  providers: [TransactionLimitRepository, TransactionLimitService],
  exports: [TransactionLimitService],
})
export class LimitsModule {}
