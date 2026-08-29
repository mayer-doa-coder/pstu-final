import type { MoneyRequest, MoneyRequestStatus } from '@prisma/client';
import type { MoneyRequestDto } from './dto/money-request.dto';

/**
 * Effective status for reads. A row can sit at PENDING past its `expiresAt`
 * because this milestone has no background sweeper (that lands with the
 * worker/outbox milestone). Until then, an elapsed deadline is surfaced as
 * EXPIRED at read time — and acceptance is blocked the same way — while the
 * stored value stays PENDING so the future sweeper still has work to claim.
 */
export function effectiveStatus(
  status: MoneyRequestStatus,
  expiresAt: Date | null,
  now: Date = new Date(),
): MoneyRequestStatus {
  if (status === 'PENDING' && expiresAt !== null && expiresAt.getTime() <= now.getTime()) {
    return 'EXPIRED';
  }
  return status;
}

export function toMoneyRequestDto(row: MoneyRequest, now: Date = new Date()): MoneyRequestDto {
  return {
    requestId: row.id,
    status: effectiveStatus(row.status, row.expiresAt, now),
    requesterUserId: row.requesterUserId,
    payerUserId: row.payerUserId,
    amountMinor: Number(row.amountMinor),
    currency: row.currency.trim(),
    note: row.note,
    acceptedTransferId: row.acceptedTransferId,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}
