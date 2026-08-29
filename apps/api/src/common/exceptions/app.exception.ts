import { HttpException } from '@nestjs/common';
import type { ErrorCode } from './error-code.enum';

/**
 * Base class for every domain-level error thrown by a business module.
 * Carries one of the catalog codes from ErrorCode so GlobalExceptionFilter
 * can build the documented `{ error: { code, message, details } }` envelope
 * without guessing a code from the HTTP status alone.
 */
export class AppException extends HttpException {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message, status);
    this.code = code;
    this.details = details;
  }
}
