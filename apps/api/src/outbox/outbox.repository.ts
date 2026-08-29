import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface OutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Prisma.InputJsonValue;
}

/** A claimed event, as handed to a consumer. */
export interface ClaimedOutboxEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  attemptCount: number;
}

interface ClaimedRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempt_count: number;
}

/**
 * Transactional outbox persistence (IMPLEMENTATION_GUIDE.md §2.8 / §6).
 *
 * `insert` takes the caller's transaction client with no default: an outbox
 * event may ONLY be written inside the same DB transaction as the financial
 * change it describes, so the two commit atomically. The worker then drains
 * events asynchronously — a transfer must never depend on that worker (or
 * Redis) being up.
 */
@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

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

  /**
   * Claim the oldest due, unprocessed event for exclusive processing.
   *
   * `FOR UPDATE SKIP LOCKED` is what makes multiple worker replicas safe: the
   * row lock is held for the whole processing transaction, and a second
   * worker running the same query *skips* the locked row and takes the next
   * one instead of blocking on it. Without SKIP LOCKED the workers would
   * serialize behind each other; without the lock they would double-process.
   *
   * `attempt_count < maxAttempts` is the bounded-retry gate: an event that
   * has exhausted its attempts drops out of the claim set permanently
   * (a dead letter) rather than being retried forever.
   */
  async claimNext(
    tx: Prisma.TransactionClient,
    maxAttempts: number,
  ): Promise<ClaimedOutboxEvent | null> {
    const rows = await tx.$queryRaw<ClaimedRow[]>`
      SELECT id::text, aggregate_type, aggregate_id, event_type, payload, attempt_count
      FROM outbox_events
      WHERE processed_at IS NULL
        AND attempt_count < ${maxAttempts}
        AND next_attempt_at <= now()
      ORDER BY occurred_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      payload: row.payload,
      attemptCount: row.attempt_count,
    };
  }

  /** Terminal success. Written inside the same transaction as the consumer's effects. */
  async markProcessed(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
    await tx.outboxEvent.update({
      where: { id: eventId },
      data: { processedAt: new Date(), lastError: null },
    });
  }

  /**
   * Record a failed attempt. Deliberately runs on its own connection, NOT in
   * the consumer's transaction — that transaction has already rolled back
   * (discarding the consumer's partial writes, which is what we want), so the
   * counter has to be persisted separately or the event would retry forever
   * with attemptCount stuck at 0.
   */
  async recordFailure(eventId: string, error: string, backoffSeconds: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE outbox_events
      SET attempt_count = attempt_count + 1,
          last_error = ${error.slice(0, 1000)},
          next_attempt_at = now() + make_interval(secs => ${backoffSeconds})
      WHERE id = ${eventId}::uuid
    `;
  }
}
