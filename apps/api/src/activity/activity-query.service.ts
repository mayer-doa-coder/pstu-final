import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-code.enum';
import { CursorPage } from '../common/pagination/cursor-page';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/pagination/cursor.util';
import type { MoneyRequestStatus } from '@prisma/client';
import { effectiveStatus } from '../money-requests/money-request.mapper';
import { UsersRepository } from '../users/users.repository';
import { type ActivityKind, type ActivityRow, ActivityRepository } from './activity.repository';
import type { ActivityItemDto, ActivityType } from './dto/activity-item.dto';
import type { ListActivityQuery } from './dto/list-activity.schema';

const KIND_BY_TYPE: Record<ActivityType, ActivityKind> = {
  TRANSFER: 'transfer',
  MONEY_REQUEST: 'money_request',
};

const TYPE_BY_KIND: Record<ActivityKind, ActivityType> = {
  transfer: 'TRANSFER',
  money_request: 'MONEY_REQUEST',
};

/**
 * Read model for `GET /activity`. Authorization is intrinsic: the underlying
 * query only ever returns rows where the caller is a participant, so there is
 * no cross-user leak to guard separately (AC-5).
 */
@Injectable()
export class ActivityQueryService {
  constructor(
    private readonly activity: ActivityRepository,
    private readonly users: UsersRepository,
  ) {}

  async listForUser(
    userId: string,
    query: ListActivityQuery,
  ): Promise<CursorPage<ActivityItemDto>> {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;

    // One extra row signals a next page without a separate count query.
    const rows = await this.activity.list({
      userId,
      cursor,
      kind: query.type ? KIND_BY_TYPE[query.type] : undefined,
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const counterparties = await this.resolveCounterparties(page);

    const items = page.map((row) => this.toDto(row, counterparties));
    const last = page.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeKeysetCursor({ createdAt: last.createdAt, id: last.referenceId })
        : null;

    return new CursorPage(items, nextCursor);
  }

  /** Single batched lookup for every distinct counterparty on the page. */
  private async resolveCounterparties(rows: ActivityRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((row) => row.counterpartyId))];
    const users = await this.users.findManyByIds(ids);
    return new Map(users.map((user) => [user.id, user.displayName]));
  }

  private toDto(row: ActivityRow, counterpartyNames: Map<string, string>): ActivityItemDto {
    const displayName = counterpartyNames.get(row.counterpartyId);
    // A money request past its deadline reads as EXPIRED here too, matching
    // the detail endpoint (no sweeper has flipped the stored row yet).
    const status =
      row.kind === 'money_request'
        ? effectiveStatus(row.status as MoneyRequestStatus, row.expiresAt)
        : row.status;
    return {
      activityId: `${row.kind === 'transfer' ? 'transfer' : 'request'}:${row.referenceId}`,
      referenceId: row.referenceId,
      type: TYPE_BY_KIND[row.kind],
      direction: row.direction,
      amountMinor: Number(row.amountMinor),
      currency: row.currency,
      status,
      counterparty: displayName ? { userId: row.counterpartyId, displayName } : null,
      createdAt: row.createdAt.toISOString(),
      relatedRequestId: row.relatedRequestId,
      relatedTransferId: row.relatedTransferId,
    };
  }

  private decodeCursor(raw: string): { createdAt: Date; id: string } {
    const decoded = decodeKeysetCursor(raw);
    if (!decoded) {
      throw new AppException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, 'Invalid cursor.');
    }
    return decoded;
  }
}
