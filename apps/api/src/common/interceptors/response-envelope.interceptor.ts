import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';

interface SuccessResponseBody<T> {
  data: T;
  meta: Record<string, unknown>;
  requestId: string;
}

/**
 * Wraps every successful controller response in the standard envelope from
 * IMPLEMENTATION_GUIDE.md §3.1 (`{ data, meta, requestId }`), so individual
 * controllers only ever return their raw payload.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, SuccessResponseBody<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<SuccessResponseBody<T>> {
    const request = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      map((data) => ({
        data,
        meta: {},
        requestId: request.requestId,
      })),
    );
  }
}
