import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthSessionRepository } from './auth-session.repository';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Module({
  imports: [
    DatabaseModule,
    UsersModule,
    WalletsModule,
    // Registered without a static secret: every sign()/verify() call passes
    // its own secret explicitly (AppConfigService.jwtAccessSecret), so this
    // stays a plain token-signing utility rather than a place a secret
    // could silently go stale. `global: true` makes JwtService injectable
    // from common/guards/jwt-auth.guard.ts without that guard depending on
    // this module.
    JwtModule.register({ global: true }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthSessionRepository, PasswordService, TokenService],
})
export class AuthModule {}
