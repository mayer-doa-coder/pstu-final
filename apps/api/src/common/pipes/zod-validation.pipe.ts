import { HttpStatus, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { AppException } from '../exceptions/app.exception';
import { ErrorCode } from '../exceptions/error-code.enum';

/**
 * Validates and normalizes a request body against a Zod schema — the same
 * validation library used for environment config, so the app has one
 * validation approach rather than mixing Zod with class-validator.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

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
