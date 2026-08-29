import type { MoneyRequestStatus } from '@prisma/client';

/**
 * Canonical money-request representation for every money-request endpoint.
 * Amounts are plain JSON numbers — demo-scale poisha values stay well inside
 * Number.MAX_SAFE_INTEGER (matches the transfer/wallet DTO convention).
 *
 * `status` is the *effective* status: a still-PENDING row whose `expiresAt`
 * has passed is reported as `EXPIRED` here even though no sweeper has run yet
 * (see money-request.mapper).
 */
export interface MoneyRequestDto {
  requestId: string;
  status: MoneyRequestStatus;
  requesterUserId: string;
  payerUserId: string;
  amountMinor: number;
  currency: string;
  note: string | null;
  /** Set once the request is ACCEPTED — the transfer that settled it. */
  acceptedTransferId: string | null;
  expiresAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
}
