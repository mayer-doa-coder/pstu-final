import { Prisma } from '@prisma/client';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Prisma's own "write conflict or deadlock" code, plus the raw PostgreSQL
// SQLSTATEs surfaced through `$queryRaw` when a `SELECT ... FOR UPDATE`
// deadlocks or a transaction fails to serialize.
const PRISMA_WRITE_CONFLICT = 'P2034';
const RAW_QUERY_FAILED = 'P2010';
const PG_SERIALIZATION_FAILURE = '40001';
const PG_DEADLOCK_DETECTED = '40P01';

/**
 * True when a failed transaction is safe to retry unchanged: PostgreSQL
 * rolled it back whole (deadlock victim or serialization failure), so
 * re-running it — with the same idempotency context — cannot double-apply
 * anything. See IMPLEMENTATION_GUIDE.md §1.5.
 */
export function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === PRISMA_WRITE_CONFLICT) {
      return true;
    }
    if (error.code === RAW_QUERY_FAILED) {
      const pgCode = (error.meta as { code?: string } | undefined)?.code;
      return pgCode === PG_SERIALIZATION_FAILURE || pgCode === PG_DEADLOCK_DETECTED;
    }
  }

  const code = (error as { code?: string } | null)?.code;
  return code === PG_SERIALIZATION_FAILURE || code === PG_DEADLOCK_DETECTED;
}

/**
 * True when `error` is a Prisma unique-constraint violation, optionally
 * scoped to a specific field/column. Used to translate a database-level
 * conflict (the actual source of truth for uniqueness) into a domain error,
 * instead of doing a racy check-then-insert.
 */
export function isUniqueConstraintViolation(error: unknown, field?: string): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== UNIQUE_CONSTRAINT_VIOLATION
  ) {
    return false;
  }

  if (!field) {
    return true;
  }

  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes(field) : target === field;
}
