import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { requestContext } from '../request-context';

const REQUEST_ID_HEADER = 'x-request-id';
const MAX_REQUEST_ID_LENGTH = 128;

/**
 * Assigns a correlation ID to every request — reusing a caller-supplied
 * `X-Request-Id` if present and well-formed, otherwise generating one — and
 * echoes it back on the response. Every downstream error response and log
 * line derives its `requestId` from this single source of truth.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId = isValidRequestId(incoming) ? incoming : randomUUID();

    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    requestContext.run(requestId, next);
  }
}

function isValidRequestId(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_REQUEST_ID_LENGTH;
}
