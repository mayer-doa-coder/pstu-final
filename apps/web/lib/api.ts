/**
 * Typed bindings for the endpoints the API actually implements today.
 *
 * Implemented: auth (csrf/register/login/refresh/logout), users (me/search),
 * wallet, transfers (create/get), money requests (create/list/get/accept/
 * decline/cancel), activity feed, notifications (list/mark-read).
 */
import { apiRequest, apiRequestPage, buildQuery } from './api-client';
import type {
  ActivityItem,
  ActivityType,
  AppNotification,
  CursorPage,
  LoginResult,
  MoneyRequest,
  MoneyRequestStatus,
  RegisterResult,
  Transfer,
  UserProfile,
  UserSearchResult,
  Wallet,
} from './api-types';

export function register(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<RegisterResult> {
  return apiRequest<RegisterResult>('/auth/register', { method: 'POST', body: input });
}

export function login(input: { email: string; password: string }): Promise<LoginResult> {
  return apiRequest<LoginResult>('/auth/login', { method: 'POST', body: input });
}

export function logout(): Promise<{ status: 'ok' }> {
  return apiRequest<{ status: 'ok' }>('/auth/logout', { method: 'POST' });
}

export function getMe(signal?: AbortSignal): Promise<UserProfile> {
  return apiRequest<UserProfile>('/users/me', { signal });
}

export function getWallet(signal?: AbortSignal): Promise<Wallet> {
  return apiRequest<Wallet>('/wallet', { signal });
}

export function searchUsers(
  params: { q: string; cursor?: string; limit?: number },
  signal?: AbortSignal,
): Promise<CursorPage<UserSearchResult>> {
  const query = buildQuery({ q: params.q, cursor: params.cursor, limit: params.limit });
  return apiRequestPage<UserSearchResult>(`/users/search${query}`, { signal });
}

/**
 * Creates a direct transfer. `idempotencyKey` must be a UUID generated once per
 * user intent and reused across retries of that same intent, so a retry
 * replays the original receipt instead of moving money twice.
 */
export function createTransfer(
  input: { receiverUserId: string; amountMinor: number; note?: string },
  idempotencyKey: string,
): Promise<Transfer> {
  return apiRequest<Transfer>('/transfers', {
    method: 'POST',
    body: {
      receiverUserId: input.receiverUserId,
      amountMinor: input.amountMinor,
      currency: 'BDT',
      ...(input.note ? { note: input.note } : {}),
    },
    idempotencyKey,
  });
}

export function getTransfer(transferId: string, signal?: AbortSignal): Promise<Transfer> {
  return apiRequest<Transfer>(`/transfers/${transferId}`, { signal });
}

/**
 * Creates a money request. Like `createTransfer`, this moves no money — it
 * only opens the request; the payer's `Idempotency-Key` on `accept` is what
 * actually settles it.
 */
export function createMoneyRequest(
  input: { payerUserId: string; amountMinor: number; note?: string; expiresAt?: string },
  idempotencyKey: string,
): Promise<MoneyRequest> {
  return apiRequest<MoneyRequest>('/money-requests', {
    method: 'POST',
    body: {
      payerUserId: input.payerUserId,
      amountMinor: input.amountMinor,
      currency: 'BDT',
      ...(input.note ? { note: input.note } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    },
    idempotencyKey,
  });
}

/** Requests where the caller is the payer — someone is asking them to pay. */
export function listIncomingRequests(
  params: { status?: MoneyRequestStatus; cursor?: string; limit?: number },
  signal?: AbortSignal,
): Promise<CursorPage<MoneyRequest>> {
  const query = buildQuery({ status: params.status, cursor: params.cursor, limit: params.limit });
  return apiRequestPage<MoneyRequest>(`/money-requests/incoming${query}`, { signal });
}

/** Requests the caller created — they are asking someone else to pay. */
export function listOutgoingRequests(
  params: { status?: MoneyRequestStatus; cursor?: string; limit?: number },
  signal?: AbortSignal,
): Promise<CursorPage<MoneyRequest>> {
  const query = buildQuery({ status: params.status, cursor: params.cursor, limit: params.limit });
  return apiRequestPage<MoneyRequest>(`/money-requests/outgoing${query}`, { signal });
}

export function getMoneyRequest(requestId: string, signal?: AbortSignal): Promise<MoneyRequest> {
  return apiRequest<MoneyRequest>(`/money-requests/${requestId}`, { signal });
}

/**
 * Accepts a money request — this is the one call in this module that moves
 * money. `idempotencyKey` must be a UUID generated once per accept attempt
 * and reused across retries of that same click, exactly like `createTransfer`.
 */
export function acceptMoneyRequest(
  requestId: string,
  idempotencyKey: string,
): Promise<MoneyRequest> {
  return apiRequest<MoneyRequest>(`/money-requests/${requestId}/accept`, {
    method: 'POST',
    idempotencyKey,
  });
}

export function declineMoneyRequest(
  requestId: string,
  idempotencyKey: string,
): Promise<MoneyRequest> {
  return apiRequest<MoneyRequest>(`/money-requests/${requestId}/decline`, {
    method: 'POST',
    idempotencyKey,
  });
}

export function cancelMoneyRequest(
  requestId: string,
  idempotencyKey: string,
): Promise<MoneyRequest> {
  return apiRequest<MoneyRequest>(`/money-requests/${requestId}/cancel`, {
    method: 'POST',
    idempotencyKey,
  });
}

/** The caller's combined transfer + money-request history, newest first. */
export function listActivity(
  params: { type?: ActivityType; cursor?: string; limit?: number },
  signal?: AbortSignal,
): Promise<CursorPage<ActivityItem>> {
  const query = buildQuery({ type: params.type, cursor: params.cursor, limit: params.limit });
  return apiRequestPage<ActivityItem>(`/activity${query}`, { signal });
}

export function listNotifications(
  params: { unreadOnly?: boolean; cursor?: string; limit?: number },
  signal?: AbortSignal,
): Promise<CursorPage<AppNotification>> {
  const query = buildQuery({
    unreadOnly: params.unreadOnly ? 'true' : undefined,
    cursor: params.cursor,
    limit: params.limit,
  });
  return apiRequestPage<AppNotification>(`/notifications${query}`, { signal });
}

export function markNotificationRead(notificationId: string): Promise<AppNotification> {
  return apiRequest<AppNotification>(`/notifications/${notificationId}/read`, { method: 'POST' });
}
