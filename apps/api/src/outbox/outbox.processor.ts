import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NotificationConsumer } from '../notifications/notification.consumer';
import { RiskExplanationConsumer } from '../risk/risk-explanation.consumer';
import { type ClaimedOutboxEvent, OutboxRepository } from './outbox.repository';

/**
 * Attempts before an event becomes a dead letter (`attempt_count` stops it
 * being claimed). Bounds retries so a permanently-bad payload cannot loop.
 */
export const MAX_ATTEMPTS = 5;

/** Base for exponential backoff: 2s, 4s, 8s, 16s. */
const BASE_BACKOFF_SECONDS = 2;

/** Ceiling on events drained per poll, so one pass can't monopolize the loop. */
const DEFAULT_BATCH_SIZE = 50;

/**
 * Drains `outbox_events` and dispatches each to its consumers.
 *
 * Processing model — one transaction per event:
 *
 *  1. Open a transaction and claim the oldest due event with
 *     `FOR UPDATE SKIP LOCKED`. The lock is held for the whole handler, so a
 *     second worker replica skips this row and picks up a different one —
 *     two workers never process the same event concurrently.
 *  2. Run the consumers and mark the event processed in that same
 *     transaction, so consumer effects and the processed flag commit together
 *     and a crash between them is impossible.
 *  3. If the handler throws, the transaction rolls back (discarding partial
 *     consumer writes) and the failure is recorded on a *separate*
 *     connection, since the rolled-back transaction cannot persist a counter.
 *
 * Delivery is therefore at-least-once — a crash after commit but before the
 * process exits can replay an event — which is why consumers must be
 * idempotent (see NotificationConsumer).
 */
@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
    private readonly notifications: NotificationConsumer,
    private readonly riskExplainer: RiskExplanationConsumer,
  ) {}

  /**
   * Drain up to `batchSize` events. Returns how many were successfully
   * processed. Exposed directly (rather than only running on a timer) so
   * tests can drive the worker deterministically.
   */
  async drain(batchSize: number = DEFAULT_BATCH_SIZE): Promise<number> {
    let processed = 0;

    for (let i = 0; i < batchSize; i++) {
      const outcome = await this.processNext();
      if (outcome === 'idle') {
        break;
      }
      if (outcome === 'processed') {
        processed++;
      }
    }

    return processed;
  }

  private async processNext(): Promise<'processed' | 'failed' | 'idle'> {
    // Holds the event across the try/catch boundary: on failure we need to
    // know which event to charge the attempt to, but the transaction that
    // claimed it has already rolled back. Also read after a successful
    // commit, for the out-of-transaction follow-up below.
    const inFlight: { event: ClaimedOutboxEvent | null } = { event: null };
    let outcome: 'processed' | 'failed' | 'idle';

    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        const claimed = await this.outbox.claimNext(tx, MAX_ATTEMPTS);
        if (!claimed) {
          return 'idle' as const;
        }
        inFlight.event = claimed;

        await this.dispatch(tx, claimed);
        await this.outbox.markProcessed(tx, claimed.id);
        return 'processed' as const;
      });
    } catch (error) {
      // No in-flight event means the claim query itself failed — there is
      // nothing to charge an attempt to.
      if (!inFlight.event) {
        this.logger.error(`Outbox claim failed: ${(error as Error).message}`);
        return 'idle';
      }

      await this.recordFailure(inFlight.event, error as Error);
      return 'failed';
    }

    // Best-effort, out-of-transaction follow-up (currently: the optional
    // LLM risk explanation). Deliberately outside the transaction above — it
    // may call an external API, and holding a DB transaction (with the
    // event's row lock) open across a network call would stall other outbox
    // rows and risk the transaction's own timeout. The event is already
    // committed as processed by this point, so a failure here can only ever
    // mean an optional annotation stays unset — never a reason to retry.
    if (outcome === 'processed' && inFlight.event) {
      await this.riskExplainer.tryExplain(inFlight.event);
    }

    return outcome;
  }

  private async dispatch(tx: Prisma.TransactionClient, event: ClaimedOutboxEvent): Promise<void> {
    await this.notifications.handle(tx, event);
  }

  private async recordFailure(event: ClaimedOutboxEvent, error: Error): Promise<void> {
    const attempt = event.attemptCount + 1;
    const backoffSeconds = BASE_BACKOFF_SECONDS * 2 ** event.attemptCount;

    // Log identifiers and the error message only — never the payload, which
    // carries user and amount details.
    this.logger.warn(
      `Outbox event ${event.id} (${event.eventType}) failed on attempt ${attempt}/${MAX_ATTEMPTS}: ${error.message}`,
    );
    if (attempt >= MAX_ATTEMPTS) {
      this.logger.error(
        `Outbox event ${event.id} (${event.eventType}) exhausted ${MAX_ATTEMPTS} attempts and will not be retried.`,
      );
    }

    try {
      await this.outbox.recordFailure(event.id, error.message, backoffSeconds);
    } catch (bookkeepingError) {
      // Losing the counter means the event retries later with a stale count —
      // acceptable, and far better than crashing the worker loop.
      this.logger.error(
        `Could not record failure for outbox event ${event.id}: ${(bookkeepingError as Error).message}`,
      );
    }
  }
}
