import { createParamDecorator, type ExecutionContext, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '../exceptions/app.exception';
import { ErrorCode } from '../exceptions/error-code.enum';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extracts and shape-validates the `Idempotency-Key` header for
 * state-changing money endpoints (IMPLEMENTATION_GUIDE.md §1.6 / §3.1).
 *
 * This is the ONLY idempotency responsibility that lives in the HTTP layer —
 * begin / replay / complete semantics belong to IdempotencyService, invoked
 * inside the domain transaction. Here we only guarantee the handler receives
 * a syntactically valid key (a UUIDv4 or UUIDv7).
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<Request>();
    const raw = request.header(IDEMPOTENCY_KEY_HEADER)?.trim();

    if (!raw || !UUID_PATTERN.test(raw)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'A valid Idempotency-Key header (UUID) is required for this operation.',
      );
    }

    return raw;
  },
);
