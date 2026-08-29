import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-code.enum';
import { CursorPage } from '../common/pagination/cursor-page';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/pagination/cursor.util';
import { toNotificationDto } from './notification.mapper';
import { NotificationsRepository } from './notifications.repository';
import type { ListNotificationsQuery } from './dto/list-notifications.schema';
import type { NotificationDto } from './dto/notification.dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read/ack side of in-app notifications. Every operation is scoped to the
 * authenticated user by the repository query itself; a notification belonging
 * to someone else is indistinguishable from one that does not exist (404), so
 * the endpoint can't be used to probe ids.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly repo: NotificationsRepository) {}

  async listForUser(
    userId: string,
    query: ListNotificationsQuery,
  ): Promise<CursorPage<NotificationDto>> {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;

    // One extra row signals a next page without a separate count query.
    const rows = await this.repo.list({
      userId,
      unreadOnly: query.unreadOnly,
      cursor,
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    const nextCursor =
      hasMore && last ? encodeKeysetCursor({ createdAt: last.createdAt, id: last.id }) : null;

    return new CursorPage(page.map(toNotificationDto), nextCursor);
  }

  /**
   * Idempotent: marking an already-read notification read again returns the
   * existing record rather than erroring, so a retried client call is safe.
   */
  async markRead(notificationId: string, userId: string): Promise<NotificationDto> {
    if (!UUID_PATTERN.test(notificationId)) {
      throw this.notFound();
    }

    await this.repo.markReadForOwner(notificationId, userId);

    const notification = await this.repo.findOwnedById(notificationId, userId);
    if (!notification) {
      throw this.notFound();
    }
    return toNotificationDto(notification);
  }

  private decodeCursor(raw: string): { createdAt: Date; id: string } {
    const decoded = decodeKeysetCursor(raw);
    if (!decoded) {
      throw new AppException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, 'Invalid cursor.');
    }
    return decoded;
  }

  private notFound(): AppException {
    return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Notification not found.');
  }
}
