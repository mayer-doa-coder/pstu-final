import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvConfig } from './env.schema';

/**
 * Typed facade over @nestjs/config so the rest of the app never reads
 * `process.env` directly or juggles untyped `ConfigService.get()` calls.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<EnvConfig, true>) {}

  get port(): number {
    return this.configService.get('PORT', { infer: true });
  }

  get databaseUrl(): string {
    return this.configService.get('DATABASE_URL', { infer: true });
  }

  get redisUrl(): string {
    return this.configService.get('REDIS_URL', { infer: true });
  }

  get corsOrigins(): string[] {
    return this.configService
      .get('CORS_ORIGINS', { infer: true })
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  get logLevel(): string {
    return this.configService.get('LOG_LEVEL', { infer: true });
  }

  get jwtAccessSecret(): string {
    return this.configService.get('JWT_ACCESS_SECRET', { infer: true });
  }

  get jwtAccessTtlSeconds(): number {
    return this.configService.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
  }

  get refreshTokenTtlDays(): number {
    return this.configService.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
  }

  get initialWalletBalanceMinor(): bigint {
    return BigInt(this.configService.get('INITIAL_WALLET_BALANCE_MINOR', { infer: true }));
  }

  get nodeEnv(): EnvConfig['NODE_ENV'] {
    return this.configService.get('NODE_ENV', { infer: true });
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
}
