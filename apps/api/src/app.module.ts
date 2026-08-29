import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { TransfersModule } from './transfers/transfers.module';
import { MoneyRequestsModule } from './money-requests/money-requests.module';
import { ActivityModule } from './activity/activity.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditModule } from './audit/audit.module';
import { SecurityModule } from './security/security.module';
import { SecurityHeadersMiddleware } from './security/security-headers.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

/**
 * Root module for the HTTP API process. Remaining domain modules
 * (notifications, audit) are added here as they land in later milestones —
 * see IMPLEMENTATION_GUIDE.md §1.3 for the full module boundary list.
 */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    SecurityModule,
    AuditModule,
    HealthModule,
    AuthModule,
    UsersModule,
    WalletsModule,
    TransfersModule,
    MoneyRequestsModule,
    ActivityModule,
    NotificationsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Security headers first, so they are present even on responses produced
    // by middleware that runs after them (or by an early error).
    consumer.apply(SecurityHeadersMiddleware, RequestIdMiddleware).forRoutes('*');
  }
}
