import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { WalletsService } from './wallets.service';
import type { WalletDto } from './dto/wallet.dto';

@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get()
  getWallet(@CurrentUser() user: AuthenticatedUser): Promise<WalletDto> {
    return this.walletsService.getForUser(user.id);
  }
}
