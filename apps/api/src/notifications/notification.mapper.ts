import type { Notification } from '@prisma/client';
import type { NotificationDto } from './dto/notification.dto';

export function toNotificationDto(row: Notification): NotificationDto {
  return {
    notificationId: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
