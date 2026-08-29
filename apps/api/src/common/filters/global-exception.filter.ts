import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppException } from '../exceptions/app.exception';
import { ErrorCode } from '../exceptions/error-code.enum';

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId: string;
}

interface ResolvedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Single place where every uncaught exception becomes the standard error
 * envelope from IMPLEMENTATION_GUIDE.md §3.1. Stack traces and internal
 * details are never sent to the client (PRD.md §4.9 — safe logging), only
 * logged server-side.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const resolved = this.resolve(exception);

    if (resolved.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: ErrorResponseBody = {
      error: { code: resolved.code, message: resolved.message, details: resolved.details },
      requestId: request.requestId,
    };

    response.status(resolved.status).json(body);
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      return this.resolveHttpException(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred.',
    };
  }

  private resolveHttpException(exception: HttpException): ResolvedError {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const rawMessage =
      typeof response === 'string'
        ? response
        : ((response as { message?: unknown }).message ?? exception.message);
    const message = Array.isArray(rawMessage) ? rawMessage.join(', ') : String(rawMessage);

    return { status, code: mapStatusToErrorCode(status), message };
  }
}

function mapStatusToErrorCode(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ErrorCode.VALIDATION_ERROR;
    case HttpStatus.UNAUTHORIZED:
      return ErrorCode.UNAUTHENTICATED;
    case HttpStatus.FORBIDDEN:
      return ErrorCode.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ErrorCode.NOT_FOUND;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ErrorCode.RATE_LIMITED;
    case HttpStatus.SERVICE_UNAVAILABLE:
      return ErrorCode.SERVICE_UNAVAILABLE;
    default:
      return ErrorCode.INTERNAL_ERROR;
  }
}
