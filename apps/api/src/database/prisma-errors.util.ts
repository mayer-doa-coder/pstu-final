import { Prisma } from '@prisma/client';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * True when `error` is a Prisma unique-constraint violation, optionally
 * scoped to a specific field/column. Used to translate a database-level
 * conflict (the actual source of truth for uniqueness) into a domain error,
 * instead of doing a racy check-then-insert.
 */
export function isUniqueConstraintViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== UNIQUE_CONSTRAINT_VIOLATION) {
    return false;
  }

  if (!field) {
    return true;
  }

  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes(field) : target === field;
}
