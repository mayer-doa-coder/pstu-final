import { Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

/**
 * Durable idempotency (IMPLEMENTATION_GUIDE.md §1.6). Stateless apart from
 * the database, so it exports only the service — consumers (transfers, and
 * later money-requests) call it with their own `tx`.
 */
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
