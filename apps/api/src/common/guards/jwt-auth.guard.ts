import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ACCESS_TOKEN_COOKIE } from '../constants/cookie-names';
import { AppConfigService } from '../../config/app-config.service';
import { AuditAction } from '../../audit/audit-action.enum';
import { AuditService } from '../../audit/audit.service';
import { AccountStatusService } from '../../security/account-status.service';
import { AppException } from '../exceptions/app.exception';
import { ErrorCode } from '../exceptions/error-code.enum';

interface AccessTokenPayload {
  sub: string;
}

/**
 * Protects routes that require an authenticated, currently-active user. Reads
 * the access token from the HttpOnly cookie (never a header — this app never
 * accepts bearer tokens) and attaches `{ id }` to `req.user` for
 * `@CurrentUser()`.
 *
 * A valid signature is necessary but not sufficient: the account's *current*
 * status is re-checked against PostgreSQL on every request, because the token
 * is stateless and outlives an account being suspended or closed. Without
 * that second check, suspending an account would not actually stop it from
 * moving money until the token expired.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly accountStatus: AccountStatusService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined;

    if (!token) {
      throw this.unauthenticated('Authentication required.');
    }

    let userId: string;
    try {
      const payload = this.jwt.verify<AccessTokenPayload>(token, {
        secret: this.config.jwtAccessSecret,
      });
      userId = payload.sub;
    } catch {
      throw this.unauthenticated('Invalid or expired session.');
    }

    const status = await this.accountStatus.findStatus(userId);
    if (status === null) {
      // Token references a user that no longer exists — treat as no session
      // rather than leaking that the id was once valid.
      throw this.unauthenticated('Invalid or expired session.');
    }

    if (status !== 'ACTIVE') {
      await this.audit.recordDetached({
        actorUserId: userId,
        action: AuditAction.ACCOUNT_BLOCKED,
        resourceType: 'user',
        resourceId: userId,
        metadata: { status, path: request.path },
      });
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        status === 'SUSPENDED'
          ? 'This account has been suspended.'
          : 'This account has been closed.',
      );
    }

    request.user = { id: userId };
    return true;
  }

  private unauthenticated(message: string): AppException {
    return new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED, message);
  }
}
