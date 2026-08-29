import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';

/**
 * Redis is non-authoritative support infrastructure only
 * (IMPLEMENTATION_GUIDE.md §1.1) — currently used for rate limiting. It must
 * never be required to reconstruct financial state, so connection failures
 * are logged, not thrown: callers (e.g. RateLimitGuard) decide how to
 * degrade when a command fails.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(config: AppConfigService) {
    this.client = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    this.client.on('error', (error: Error) => this.logger.warn(`Redis error: ${error.message}`));
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.log('Connected to Redis.');
    } catch (error) {
      this.logger.warn(`Could not connect to Redis at startup: ${(error as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }

  /** Atomically increments `key`, setting its TTL only on the first increment of a window. Returns the new count. */
  async incrementWithExpiry(key: string, windowSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, windowSeconds);
    }
    return count;
  }
}
