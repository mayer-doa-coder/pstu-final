import { Injectable, type LoggerService } from '@nestjs/common';
import pino, { type Logger as PinoLogger } from 'pino';
import { requestContext } from '../request-context';

/**
 * Nest LoggerService backed by pino. Every log call is automatically bound
 * to the current request's correlation ID (via AsyncLocalStorage), so log
 * lines can be traced back to a single request without passing requestId
 * around explicitly — see PRD.md §3.10 (Auditability) and
 * IMPLEMENTATION_GUIDE.md Milestone 7.
 */
@Injectable()
export class AppLogger implements LoggerService {
  private readonly logger: PinoLogger;

  constructor() {
    const isProduction = process.env.NODE_ENV === 'production';

    this.logger = pino({
      level: process.env.LOG_LEVEL ?? 'info',
      transport: isProduction
        ? undefined
        : { target: 'pino-pretty', options: { singleLine: true, colorize: true } },
    });
  }

  log(message: unknown, context?: string): void {
    this.scoped().info({ context }, this.stringify(message));
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.scoped().error({ context, trace }, this.stringify(message));
  }

  warn(message: unknown, context?: string): void {
    this.scoped().warn({ context }, this.stringify(message));
  }

  debug(message: unknown, context?: string): void {
    this.scoped().debug({ context }, this.stringify(message));
  }

  verbose(message: unknown, context?: string): void {
    this.scoped().trace({ context }, this.stringify(message));
  }

  private scoped(): PinoLogger {
    const requestId = requestContext.getStore();
    return requestId ? this.logger.child({ requestId }) : this.logger;
  }

  private stringify(message: unknown): string {
    return typeof message === 'string' ? message : JSON.stringify(message);
  }
}
