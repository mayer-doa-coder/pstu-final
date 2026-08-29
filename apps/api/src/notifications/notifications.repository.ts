import { Injectable } from '@nestjs/common';
import type { Notification, Prisma } from '@prisma/client';
import type { KeysetCursor } from '../common/pagination/cursor.util';
import { PrismaService } from '../database/prisma.service';

export interface CreateNotificationData {
  userId: string;
  type: string;
  title: string;
  body: string;
  resourceType: string;
  resourceId: string;
  /** The outbox event that produced this — the at-least-once dedupe key. */
  sourceEventId: string;
}

export interface ListNotificationsCriteria {
  userId: string;
  unreadOnly: boolean;
  cursor?: KeysetCursor;
  /** Callers pass `pageSize + 1` to detect a next page without a count query. */
  take: number;
}

/**
 * Owns all `notifications` persistence. Every read and write is scoped by
 * `userId` at the query level — there is no method that can return or mutate
 * another user's notification, so ownership can't be forgotten at a call site.
 */
@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Insert unless this outbox event already produced a notification for this
   * user. `ON CONFLICT DO NOTHING` against the UNIQUE
   * `(source_event_id, user_id)` index is what makes the consumer idempotent
   * under at-least-once delivery — a re-processed event is a no-op, not a
   * duplicate. Raw SQL because Prisma has no ON CONFLICT primitive and a
   * caught unique violation would poison the surrounding transaction.
   */
  async insertIfAbsent(
    tx: Prisma.TransactionClient,
    data: CreateNotificationData,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO notifications
        (id, user_id, type, title, body, resource_type, resource_id, created_at, source_event_id)
      VALUES
        (gen_random_uuid(), ${data.userId}::uuid, ${data.type}, ${data.title}, ${data.body},
         ${data.resourceType}, ${data.resourceId}::uuid, now(), ${data.sourceEventId}::uuid)
      ON CONFLICT (source_event_id, user_id) DO NOTHING
      RETURNING id::text
    `;
    return rows.length > 0;
  }

  /** Keyset-paginated, newest first — matches the covering index. */
  list(criteria: ListNotificationsCriteria): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: {
        userId: criteria.userId,
        ...(criteria.unreadOnly ? { readAt: null } : {}),
        ...(criteria.cursor
          ? {
              OR: [
                { createdAt: { lt: criteria.cursor.createdAt } },
                { createdAt: criteria.cursor.createdAt, id: { lt: criteria.cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: criteria.take,
    });
  }

  /**
   * Mark one notification read, scoped to its owner. The `userId` predicate
   * is part of the UPDATE itself — a non-owner's call matches zero rows and
   * can neither mutate nor confirm the notification exists. Already-read
   * notifications are left untouched so `readAt` records the first read.
   */
  async markReadForOwner(notificationId: string, userId: string): Promise<boolean> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return count > 0;
  }

  findOwnedById(notificationId: string, userId: string): Promise<Notification | null> {
    return this.prisma.notification.findFirst({ where: { id: notificationId, userId } });
  }
}
