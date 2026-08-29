import type { WalletStatus } from '@prisma/client';

export interface WalletDto {
  walletId: string;
  currency: string;
  balanceMinor: number;
  status: WalletStatus;
}
