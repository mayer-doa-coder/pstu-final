import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WalletsController } from './wallets.controller';
import { WalletsRepository } from './wallets.repository';
import { WalletsService } from './wallets.service';

@Module({
  imports: [DatabaseModule],
  controllers: [WalletsController],
  providers: [WalletsRepository, WalletsService],
  exports: [WalletsRepository],
})
export class WalletsModule {}
