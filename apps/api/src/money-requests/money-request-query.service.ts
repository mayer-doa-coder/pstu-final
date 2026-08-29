import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-code.enum';
import { CursorPage } from '../common/pagination/cursor-page';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/pagination/cursor.util';
import { toMoneyRequestDto } from './money-request.mapper';
import { type ParticipantRole, MoneyRequestsRepository } from './money-requests.repository';
import type { ListMoneyRequestsQuery } from './dto/list-money-requests.schema';
import type { MoneyRequestDto } from './dto/money-request.dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read side of the money-request endpoints. Authorization is a participant
 * check: only the requester or the payer of a request may see it. A
 * non-participant (or unknown id) gets an identical `404` so the endpoint
 * can't be used to probe which request ids exist (AC-5).
 */
@Injectable()
export class MoneyRequestQueryService {
  constructor(private readonly repo: MoneyRequestsRepository) {}

  /** Requests where the caller is the payer — someone is asking them to pay. */
  listIncoming(
    userId: string,
    query: ListMoneyRequestsQuery,
  ): Promise<CursorPage<MoneyRequestDto>> {
    return this.list('payer', userId, query);
  }

  /** Requests the caller created — they are asking someone else to pay. */
  listOutgoing(
    userId: string,
    query: ListMoneyRequestsQuery,
  ): Promise<CursorPage<MoneyRequestDto>> {
    return this.list('requester', userId, query);
  }

  async getForParticipant(requestId: string, requesterUserId: string): Promise<MoneyRequestDto> {
    if (!UUID_PATTERN.test(requestId)) {
      throw this.notFound();
    }

    const request = await this.repo.findById(requestId);
    if (!request) {
      throw this.notFound();
    }

    const isParticipant =
      request.requesterUserId === requesterUserId || request.payerUserId === requesterUserId;
    if (!isParticipant) {
      throw this.notFound();
    }

    return toMoneyRequestDto(request);
  }

  private async list(
    role: ParticipantRole,
    userId: string,
    query: ListMoneyRequestsQuery,
  ): Promise<CursorPage<MoneyRequestDto>> {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;

    // One extra row tells us whether a next page exists without a count query.
    const rows = await this.repo.listForParticipant({
      role,
      userId,
      status: query.status,
      cursor,
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    const nextCursor =
      hasMore && last ? encodeKeysetCursor({ createdAt: last.createdAt, id: last.id }) : null;

    const now = new Date();
    return new CursorPage(
      page.map((row) => toMoneyRequestDto(row, now)),
      nextCursor,
    );
  }

  private decodeCursor(raw: string): { createdAt: Date; id: string } {
    const decoded = decodeKeysetCursor(raw);
    if (!decoded) {
      throw new AppException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, 'Invalid cursor.');
    }
    return decoded;
  }

  private notFound(): AppException {
    return new AppException(
      HttpStatus.NOT_FOUND,
      ErrorCode.MONEY_REQUEST_NOT_FOUND,
      'Money request not found.',
    );
  }
}
