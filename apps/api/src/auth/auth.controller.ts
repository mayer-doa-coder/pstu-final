import { randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { buildCookieOptions } from '../common/cookies/cookie-options.util';
import {
  ACCESS_TOKEN_COOKIE,
  CSRF_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '../common/constants/cookie-names';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { toUserProfileDto } from '../users/user.mapper';
import type { UserProfileDto } from '../users/dto/user-profile.dto';
import { toWalletDto } from '../wallets/wallet.mapper';
import type { WalletDto } from '../wallets/dto/wallet.dto';
import { AuthService, type IssuedSession } from './auth.service';
import { loginSchema, type LoginInput } from './dto/login.schema';
import { registerSchema, type RegisterInput } from './dto/register.schema';

const CSRF_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_PATH = '/api/v1/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Get('csrf')
  issueCsrfToken(@Res({ passthrough: true }) res: Response): { csrfToken: string } {
    const csrfToken = randomBytes(32).toString('hex');

    res.cookie(
      CSRF_TOKEN_COOKIE,
      csrfToken,
      buildCookieOptions(this.config, { httpOnly: false, maxAgeMs: CSRF_TOKEN_MAX_AGE_MS }),
    );

    return { csrfToken };
  }

  @UseGuards(CsrfGuard)
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: UserProfileDto; wallet: WalletDto }> {
    const { user, wallet } = await this.authService.register(body);
    await this.establishSession(user.id, req, res);

    return { user: toUserProfileDto(user), wallet: toWalletDto(wallet) };
  }

  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: UserProfileDto }> {
    const user = await this.authService.login(body);
    await this.establishSession(user.id, req, res);

    return { user: toUserProfileDto(user) };
  }

  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: 'ok' }> {
    const presented = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    const session = await this.authService.refresh(presented, req.header('user-agent'));
    this.setSessionCookies(res, session);

    return { status: 'ok' };
  }

  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: 'ok' }> {
    const presented = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    await this.authService.logout(presented);

    res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: REFRESH_TOKEN_PATH });

    return { status: 'ok' };
  }

  private async establishSession(userId: string, req: Request, res: Response): Promise<void> {
    const session = await this.authService.createSession(userId, req.header('user-agent'));
    this.setSessionCookies(res, session);
  }

  private setSessionCookies(res: Response, session: IssuedSession): void {
    res.cookie(
      ACCESS_TOKEN_COOKIE,
      session.accessToken,
      buildCookieOptions(this.config, { maxAgeMs: this.config.jwtAccessTtlSeconds * 1000 }),
    );
    res.cookie(
      REFRESH_TOKEN_COOKIE,
      session.refreshToken,
      buildCookieOptions(this.config, {
        maxAgeMs: this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
        path: REFRESH_TOKEN_PATH,
      }),
    );
  }
}
