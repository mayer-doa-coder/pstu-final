/**
 * Canonical error codes returned in the `error.code` field of every error
 * response. Sourced verbatim from IMPLEMENTATION_GUIDE.md §3.2 — domain
 * modules must reuse these rather than inventing new codes, so clients can
 * branch on a stable, documented catalog.
 */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  FORBIDDEN = 'FORBIDDEN',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  TRANSFER_NOT_FOUND = 'TRANSFER_NOT_FOUND',
  MONEY_REQUEST_NOT_FOUND = 'MONEY_REQUEST_NOT_FOUND',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  /** A daily/weekly/monthly send limit would be exceeded — distinct from INSUFFICIENT_BALANCE: the wallet has the money, policy caps it. */
  TRANSFER_LIMIT_EXCEEDED = 'TRANSFER_LIMIT_EXCEEDED',
  REQUEST_ALREADY_RESOLVED = 'REQUEST_ALREADY_RESOLVED',
  IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED',
  WALLET_UNAVAILABLE = 'WALLET_UNAVAILABLE',
  INVALID_TRANSFER = 'INVALID_TRANSFER',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  /** Generic 404 for routes/resources with no more specific catalog entry. */
  NOT_FOUND = 'NOT_FOUND',
}
