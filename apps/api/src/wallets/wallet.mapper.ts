import type { Wallet } from '@prisma/client';
import type { WalletDto } from './dto/wallet.dto';

// Demo-scale balances are far below Number.MAX_SAFE_INTEGER, so converting
// bigint -> number at the API boundary is safe and matches
// IMPLEMENTATION_GUIDE.md §3.5's example response (a plain JSON number).
export function toWalletDto(wallet: Wallet): WalletDto {
  return {
    walletId: wallet.id,
    currency: wallet.currency,
    balanceMinor: Number(wallet.balanceMinor),
    status: wallet.status,
  };
}
