import { Module } from '@nestjs/common';
import { NotificationsCoreModule } from './notifications-core.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * The HTTP surface for in-app notifications (read + mark-as-read). Creation
 * happens only in the worker, via NotificationsCoreModule's consumer.
 */
@Module({
  imports: [NotificationsCoreModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
