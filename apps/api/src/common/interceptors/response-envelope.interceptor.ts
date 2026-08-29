import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';
import { CursorPage } from '../pagination/cursor-page';

interface SuccessResponseBody<T> {
  data: T;
  meta: Record<string, unknown>;
  requestId: string;
}

/**
 * Wraps every successful controller response in the standard envelope from
 * IMPLEMENTATION_GUIDE.md §3.1 (`{ data, meta, requestId }`). A controller
 * returning a `CursorPage` gets its `nextCursor` placed in `meta` (§3.4's
 * `{ data: [...], meta: { nextCursor } }` shape); everything else is
 * wrapped as `data` with an empty `meta`.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, SuccessResponseBody<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<SuccessResponseBody<T>> {
    const request = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      map((result) => {
        if (result instanceof CursorPage) {
          return {
            data: result.data as T,
            meta: { nextCursor: result.nextCursor },
            requestId: request.requestId,
          };
        }
        return { data: result, meta: {}, requestId: request.requestId };
      }),
    );
  }
}
