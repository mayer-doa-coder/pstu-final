/**
 * Closed catalog of auditable actions. A fixed enum (rather than free-form
 * strings at call sites) keeps the audit trail queryable — an investigator
 * can filter on an exact action without guessing spellings.
 */
export enum AuditAction {
  USER_REGISTERED = 'user.registered',
  LOGIN_SUCCEEDED = 'auth.login_succeeded',
  LOGIN_FAILED = 'auth.login_failed',
  LOGGED_OUT = 'auth.logged_out',
  SESSION_REFRESHED = 'auth.session_refreshed',
  /** A revoked refresh token was replayed — every session for that user was revoked. */
  REFRESH_REUSE_DETECTED = 'auth.refresh_reuse_detected',
  /** A request arrived with a valid token but a SUSPENDED/CLOSED account. */
  ACCOUNT_BLOCKED = 'auth.account_blocked',

  TRANSFER_SUCCEEDED = 'transfer.succeeded',
  TRANSFER_FAILED = 'transfer.failed',
  /** The deterministic risk engine scored a transfer MEDIUM or HIGH. */
  TRANSFER_RISK_FLAGGED = 'transfer.risk_flagged',

  MONEY_REQUEST_CREATED = 'money_request.created',
  MONEY_REQUEST_ACCEPTED = 'money_request.accepted',
  MONEY_REQUEST_DECLINED = 'money_request.declined',
  MONEY_REQUEST_CANCELLED = 'money_request.cancelled',

  NID_VERIFIED = 'user.nid_verified',
  NID_REJECTED = 'user.nid_rejected',
}

/** Resource families an audit row can point at. */
export type AuditResourceType = 'user' | 'session' | 'transfer' | 'money_request';
