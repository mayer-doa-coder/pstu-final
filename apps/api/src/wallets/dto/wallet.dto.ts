import type { WalletStatus } from '@prisma/client';
import type { LimitUsageDto } from '../../limits/dto/limit-usage.dto';

export interface WalletDto {
  walletId: string;
  currency: string;
  balanceMinor: number;
  status: WalletStatus;
  /** Current usage against the caller's rolling daily/weekly/monthly send limits. */
  limits: LimitUsageDto;
}
