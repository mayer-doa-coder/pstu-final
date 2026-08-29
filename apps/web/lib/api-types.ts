/**
 * Mirrors the backend DTOs exactly as implemented. Do not add fields the API
 * does not return — the contract is owned by apps/api, not by this UI.
 *
 * Sources:
 *   users/dto/user-profile.dto.ts, users/dto/user-search-result.dto.ts,
 *   wallets/dto/wallet.dto.ts, transfers/dto/transfer.dto.ts,
 *   money-requests/dto/money-request.dto.ts, activity/dto/activity-item.dto.ts,
 *   notifications/dto/notification.dto.ts,
 *   common/pagination/cursor-page.ts, common/exceptions/error-code.enum.ts
 */

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type WalletStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED';
export type TransferStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export type VerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'REJECTED';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  createdAt: string;
  /** Simulated NID/KYC status — VERIFIED is the badge shown in the UI. */
  verificationStatus: VerificationStatus;
  /** e.g. `••••••7890`. Null until the user has submitted an NID. */
  nidMasked: string | null;
}

/** Response of `POST /verification/nid`. */
export interface VerificationResult {
  verificationStatus: VerificationStatus;
  nidMasked: string | null;
  verifiedAt: string | null;
}

export interface UserSearchResult {
  id: string;
  displayName: string;
  maskedEmail: string;
}

export interface LimitWindow {
  limitMinor: number;
  usedMinor: number;
  remainingMinor: number;
}

/** Current usage against the caller's rolling daily/weekly/monthly send limits. */
export interface LimitUsage {
  daily: LimitWindow;
  weekly: LimitWindow;
  monthly: LimitWindow;
}

export interface Wallet {
  walletId: string;
  currency: string;
  balanceMinor: number;
  status: WalletStatus;
  limits: LimitUsage;
}

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/** The deterministic fraud/risk engine's decision for a transfer. */
export interface TransferRisk {
  score: number;
  level: RiskLevel;
  reasons: string[];
  /** Plain-language gloss from the optional LLM step; null until produced (HIGH only) or if never configured. */
  explanation: string | null;
}

export interface Transfer {
  transferId: string;
  status: TransferStatus;
  senderUserId: string;
  receiverUserId: string;
  amountMinor: number;
  currency: string;
  note: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Present on the create receipt only. */
  senderBalanceAfterMinor?: number;
  risk?: TransferRisk;
}

export type MoneyRequestStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';

export interface MoneyRequest {
  requestId: string;
  status: MoneyRequestStatus;
  requesterUserId: string;
  payerUserId: string;
  amountMinor: number;
  currency: string;
  note: string | null;
  /** Set once the request is ACCEPTED — the transfer that settled it. */
  acceptedTransferId: string | null;
  expiresAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export type ActivityType = 'TRANSFER' | 'MONEY_REQUEST';
export type ActivityDirection = 'IN' | 'OUT' | 'REQUEST';

export interface ActivityCounterparty {
  userId: string;
  displayName: string;
}

export interface ActivityItem {
  /** `transfer:<uuid>` or `request:<uuid>` — stable, resource-qualified. */
  activityId: string;
  referenceId: string;
  type: ActivityType;
  direction: ActivityDirection;
  amountMinor: number;
  currency: string;
  status: string;
  counterparty: ActivityCounterparty | null;
  createdAt: string;
  relatedRequestId: string | null;
  relatedTransferId: string | null;
}

export interface AppNotification {
  notificationId: string;
  type: string;
  title: string;
  body: string;
  resourceType: string | null;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface RegisterResult {
  user: UserProfile;
  wallet: Wallet;
}

export interface LoginResult {
  user: UserProfile;
}

/** `{ data, meta: { nextCursor } }` from ResponseEnvelopeInterceptor. */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Canonical error codes from the backend catalog. */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'USER_NOT_FOUND'
  | 'TRANSFER_NOT_FOUND'
  | 'MONEY_REQUEST_NOT_FOUND'
  | 'INSUFFICIENT_BALANCE'
  | 'TRANSFER_LIMIT_EXCEEDED'
  | 'REQUEST_ALREADY_RESOLVED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'WALLET_UNAVAILABLE'
  | 'INVALID_TRANSFER'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'NOT_FOUND'
  /** Client-side only: request never produced an HTTP response. */
  | 'NETWORK_ERROR'
  /** Client-side only: outcome genuinely unknown (may have committed). */
  | 'AMBIGUOUS_OUTCOME';
