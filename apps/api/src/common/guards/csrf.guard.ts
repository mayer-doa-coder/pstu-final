import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { CSRF_TOKEN_COOKIE, CSRF_TOKEN_HEADER } from '../constants/cookie-names';
import { AppException } from '../exceptions/app.exception';
import { ErrorCode } from '../exceptions/error-code.enum';

/**
 * Double-submit CSRF check for cookie-authenticated, state-changing auth
 * routes (register/login/refresh/logout — PRD.md §7.5). The client must
 * first call GET /auth/csrf, which sets a non-HttpOnly `csrf_token` cookie;
 * a cross-site attacker's forged request can trigger the ambient cookie but
 * cannot read its value to echo it back in the header, so the two only
 * match for a same-origin caller.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const cookieToken = request.cookies?.[CSRF_TOKEN_COOKIE] as string | undefined;
    const headerToken = request.header(CSRF_TOKEN_HEADER);

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'Missing or invalid CSRF token.',
      );
    }

    return true;
  }
}
