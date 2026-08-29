import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-code.enum';
import { WalletsRepository } from './wallets.repository';
import { toWalletDto } from './wallet.mapper';
import type { WalletDto } from './dto/wallet.dto';

@Injectable()
export class WalletsService {
  constructor(private readonly walletsRepository: WalletsRepository) {}

  async getForUser(userId: string): Promise<WalletDto> {
    const wallet = await this.walletsRepository.findByUserId(userId);

    if (!wallet) {
      // Every active user has exactly one wallet, created atomically at
      // registration (AuthService.register). Reaching here means that
      // invariant was violated, not a normal "not found" case.
      throw new AppException(HttpStatus.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL_ERROR, 'Wallet not found for user.');
    }

    return toWalletDto(wallet);
  }
}
