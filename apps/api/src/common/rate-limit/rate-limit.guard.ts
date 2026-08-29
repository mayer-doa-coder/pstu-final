import { type CanActivate, type ExecutionContext, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RedisService } from '../../redis/redis.service';
import { AppException } from '../exceptions/app.exception';
import { ErrorCode } from '../exceptions/error-code.enum';
import { RATE_LIMIT_KEY, type RateLimitOptions } from './rate-limit.decorator';

/**
 * Fixed-window rate limiter, keyed by authenticated user (falls back to IP
 * if unauthenticated) + route. Only applies to handlers annotated with
 * `@RateLimit()`. Must run after JwtAuthGuard on routes where user identity
 * matters for the key.
 *
 * Redis is non-authoritative (IMPLEMENTATION_GUIDE.md §1.1): if the rate
 * check itself fails (Redis unreachable), the request is allowed through
 * rather than taking down a non-financial endpoint over a cache outage —
 * this guard only ever adds friction, never determines correctness.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<RateLimitOptions | undefined>(RATE_LIMIT_KEY, context.getHandler());
    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const identity = request.user?.id ?? request.ip;
    const key = `rate-limit:${context.getClass().name}:${context.getHandler().name}:${identity}`;

    try {
      const count = await this.redis.incrementWithExpiry(key, options.windowSeconds);
      if (count > options.limit) {
        throw new AppException(HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMITED, 'Too many requests. Please slow down.');
      }
      return true;
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      this.logger.warn(`Rate limit check unavailable, allowing request through: ${(error as Error).message}`);
      return true;
    }
  }
}
