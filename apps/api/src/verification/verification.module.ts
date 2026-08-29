import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { UsersModule } from '../users/users.module';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

/** Simulated NID/KYC verification. Owns no table of its own — it writes the verification columns on `users`. */
@Module({
  imports: [DatabaseModule, UsersModule],
  controllers: [VerificationController],
  providers: [VerificationService],
})
export class VerificationModule {}
