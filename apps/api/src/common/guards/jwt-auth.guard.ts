import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ACCESS_TOKEN_COOKIE } from '../constants/cookie-names';
import { AppConfigService } from '../../config/app-config.service';
import { AppException } from '../exceptions/app.exception';
import { ErrorCode } from '../exceptions/error-code.enum';

interface AccessTokenPayload {
  sub: string;
}

/**
 * Protects routes that require an authenticated user. Reads the access
 * token from the HttpOnly cookie (never a header — this app never accepts
 * bearer tokens) and attaches `{ id }` to `req.user` for `@CurrentUser()`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined;

    if (!token) {
      throw new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED, 'Authentication required.');
    }

    try {
      const payload = this.jwt.verify<AccessTokenPayload>(token, { secret: this.config.jwtAccessSecret });
      request.user = { id: payload.sub };
      return true;
    } catch {
      throw new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED, 'Invalid or expired session.');
    }
  }
}
