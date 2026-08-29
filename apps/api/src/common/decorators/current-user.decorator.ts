import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../types/authenticated-user';

/** Extracts the identity JwtAuthGuard attached to the request. Only valid on routes guarded by JwtAuthGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedUser => {
  const request = context.switchToHttp().getRequest<Request>();
  return request.user as AuthenticatedUser;
});
