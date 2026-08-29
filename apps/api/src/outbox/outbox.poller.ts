import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { OutboxProcessor } from './outbox.processor';

const POLL_INTERVAL_MS = 1_000;
/** Backoff after an unexpected loop-level error, so a hard outage doesn't spin. */
const ERROR_BACKOFF_MS = 5_000;

/**
 * Drives OutboxProcessor on a timer in the worker process.
 *
 * Deliberately a simple poll loop rather than a queue: PostgreSQL is already
 * the durable source of truth (IMPLEMENTATION_GUIDE.md §1.1), and
 * `FOR UPDATE SKIP LOCKED` gives safe multi-worker distribution without a
 * second system that could be down. Redis/BullMQ would add a dependency the
 * financial path is explicitly forbidden from relying on.
 *
 * Runs only where it is registered (WorkerModule), never in the API process —
 * so a request handler is never delayed by event dispatch.
 */
@Injectable()
export class OutboxPoller implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxPoller.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(private readonly processor: OutboxProcessor) {}

  onModuleInit(): void {
    this.scheduleNext(0);
    this.logger.log(`Outbox poller started (interval ${POLL_INTERVAL_MS}ms).`);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    // Deliberately NOT unref'd: this timer is the only thing keeping the
    // worker process's event loop alive (worker.ts binds no HTTP listener).
    // An unref'd timer lets Node treat the process as idle the instant
    // nothing else is pending and exit before the timer ever fires — which
    // is exactly what happened here: one drain, then immediate exit,
    // repeating forever under `restart: unless-stopped`.
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    // Re-entrancy guard: a slow drain must not overlap with the next tick.
    if (this.running || this.stopped) {
      return;
    }
    this.running = true;

    try {
      const processed = await this.processor.drain();
      if (processed > 0) {
        this.logger.log(`Processed ${processed} outbox event(s).`);
      }
      this.scheduleNext(POLL_INTERVAL_MS);
    } catch (error) {
      this.logger.error(`Outbox poll failed: ${(error as Error).message}`);
      this.scheduleNext(ERROR_BACKOFF_MS);
    } finally {
      this.running = false;
    }
  }
}
