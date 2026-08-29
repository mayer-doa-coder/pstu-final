import { HttpStatus, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';
import { AppException } from '../exceptions/app.exception';
import { ErrorCode } from '../exceptions/error-code.enum';

/**
 * Validates and normalizes a request body or query against a Zod schema — the
 * same validation library used for environment config, so the app has one
 * validation approach rather than mixing Zod with class-validator.
 *
 * The schema's *input* is typed `unknown` (not `T`): what arrives off the wire
 * is untrusted and untyped, so schemas are free to coerce and transform it
 * (`"20"` -> `20`, `"true"` -> `true`) on the way to `T`.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const details = {
        issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      };
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Invalid request body.',
        details,
      );
    }

    return result.data;
  }
}
