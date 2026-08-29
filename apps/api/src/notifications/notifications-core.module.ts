import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NotificationConsumer } from './notification.consumer';
import { NotificationsRepository } from './notifications.repository';

/**
 * Notification persistence and the outbox consumer — everything needed to
 * *produce* a notification, and nothing HTTP.
 *
 * Split out from NotificationsModule so the worker process can import it
 * without pulling in NotificationsController, whose JwtAuthGuard depends on
 * the API's auth wiring. The worker serves no requests and has no sessions.
 */
@Module({
  imports: [DatabaseModule],
  providers: [NotificationsRepository, NotificationConsumer],
  exports: [NotificationsRepository, NotificationConsumer],
})
export class NotificationsCoreModule {}
