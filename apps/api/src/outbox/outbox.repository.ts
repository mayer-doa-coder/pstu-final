import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export interface OutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Prisma.InputJsonValue;
}

/**
 * Transactional outbox writer (IMPLEMENTATION_GUIDE.md §2.8 / §6).
 *
 * `insert` takes the caller's transaction client with no default: an outbox
 * event may ONLY be written inside the same DB transaction as the financial
 * change it describes, so the two commit atomically. Notifications/analytics
 * are then produced asynchronously by the Milestone 6 worker — a transfer
 * must never depend on that worker (or Redis) being up.
 */
@Injectable()
export class OutboxRepository {
  insert(tx: Prisma.TransactionClient, event: OutboxEventInput): Promise<{ id: string }> {
    return tx.outboxEvent.create({
      data: {
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload,
      },
      select: { id: true },
    });
  }
}
