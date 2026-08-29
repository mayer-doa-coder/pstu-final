import type { Transfer } from '@prisma/client';
import type { RiskAssessmentDto } from '../risk/dto/risk-assessment.dto';
import type { TransferDto } from './dto/transfer.dto';

export function toTransferDto(
  transfer: Transfer,
  senderBalanceAfterMinor?: bigint,
  risk?: RiskAssessmentDto,
): TransferDto {
  return {
    transferId: transfer.id,
    status: transfer.status,
    senderUserId: transfer.senderUserId,
    receiverUserId: transfer.receiverUserId,
    amountMinor: Number(transfer.amountMinor),
    currency: transfer.currency.trim(),
    note: transfer.note,
    createdAt: transfer.createdAt.toISOString(),
    completedAt: transfer.completedAt ? transfer.completedAt.toISOString() : null,
    ...(senderBalanceAfterMinor !== undefined
      ? { senderBalanceAfterMinor: Number(senderBalanceAfterMinor) }
      : {}),
    ...(risk ? { risk } : {}),
  };
}
