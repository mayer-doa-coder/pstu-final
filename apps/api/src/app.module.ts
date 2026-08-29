import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

/**
 * Root module for the HTTP API process. Remaining domain modules
 * (transfers, ledger, money-requests, idempotency, activity, notifications,
 * outbox, audit) are added here as they land in later milestones — see
 * IMPLEMENTATION_GUIDE.md §1.3 for the full module boundary list.
 */
@Module({
  imports: [AppConfigModule, DatabaseModule, RedisModule, HealthModule, AuthModule, UsersModule, WalletsModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
