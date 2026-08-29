import type { TransferStatus } from '@prisma/client';

/**
 * Canonical transfer representation returned by `POST /transfers` (with
 * `senderBalanceAfterMinor` set) and `GET /transfers/:id` (without it).
 * Amounts are plain JSON numbers — demo-scale poisha values are far below
 * Number.MAX_SAFE_INTEGER (matches the wallet DTO convention).
 */
export interface TransferDto {
  transferId: string;
  status: TransferStatus;
  senderUserId: string;
  receiverUserId: string;
  amountMinor: number;
  currency: string;
  note: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Sender's wallet balance immediately after this transfer. Present on the create receipt only. */
  senderBalanceAfterMinor?: number;
}
