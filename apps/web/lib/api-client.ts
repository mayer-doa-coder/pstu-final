/**
 * Thin fetch wrapper over the API.
 *
 * Auth is cookie-based: the browser holds httpOnly `access_token` /
 * `refresh_token` cookies set by the API. This client NEVER reads, writes, or
 * stores a token — no localStorage, no sessionStorage. Every request is sent
 * with `credentials: 'include'` so the cookies travel; state-changing requests
 * echo the readable `csrf_token` cookie back in the `X-CSRF-Token` header
 * (double-submit, see api CsrfGuard).
 */
import type { ApiErrorCode, CursorPage } from './api-types';

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1'
).replace(/\/+$/, '');

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'X-CSRF-Token';
const IDEMPOTENCY_HEADER = 'Idempotency-Key';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;

  constructor(params: {
    code: ApiErrorCode;
    message: string;
    status: number;
    details?: Record<string, unknown>;
    requestId?: string;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
    this.requestId = params.requestId;
  }

  /**
   * True when the request may or may not have been applied server-side (a
   * timeout or dropped connection after the write could have committed).
   * The UI must not present these as a hard failure — CLAUDE.md error
   * handling philosophy.
   */
  get isAmbiguous(): boolean {
    return this.code === 'AMBIGUOUS_OUTCOME';
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
  requestId?: string;
}

interface SuccessEnvelope<T> {
  data: T;
  meta?: { nextCursor?: string | null };
  requestId?: string;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/**
 * Ensures a CSRF token cookie exists before a state-changing call. The API
 * issues it via GET /auth/csrf and also sets the readable cookie.
 */
export async function ensureCsrfToken(): Promise<string> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) {
    return existing;
  }

  await fetch(`${API_BASE_URL}/auth/csrf`, {
    method: 'GET',
    credentials: 'include',
  });

  const issued = readCookie(CSRF_COOKIE);
  if (!issued) {
    throw new ApiError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Could not establish a secure session with the server.',
      status: 0,
    });
  }

  return issued;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** UUID for money-moving writes; sent as the `Idempotency-Key` header. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<SuccessEnvelope<T>> {
  const method = options.method ?? 'GET';
  const isStateChanging = method !== 'GET';
  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (isStateChanging) {
    headers[CSRF_HEADER] = await ensureCsrfToken();
  }

  if (options.idempotencyKey) {
    headers[IDEMPOTENCY_HEADER] = options.idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause;
    }

    // A state-changing request that never returned a response may still have
    // committed on the server. Surface that as ambiguous, not as a failure.
    throw new ApiError({
      code: isStateChanging ? 'AMBIGUOUS_OUTCOME' : 'NETWORK_ERROR',
      message: isStateChanging
        ? 'We could not confirm whether this went through. Check your activity before retrying.'
        : 'Could not reach the server. Check your connection and try again.',
      status: 0,
    });
  }

  const payload = (await response.json().catch(() => null)) as
    | SuccessEnvelope<T>
    | ErrorEnvelope
    | null;

  if (!response.ok) {
    const envelope = (payload ?? {}) as ErrorEnvelope;
    throw new ApiError({
      code: (envelope.error?.code as ApiErrorCode | undefined) ?? 'INTERNAL_ERROR',
      message: envelope.error?.message ?? 'Something went wrong. Please try again.',
      status: response.status,
      details: envelope.error?.details,
      requestId: envelope.requestId,
    });
  }

  if (payload === null) {
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: 'The server returned an unreadable response.',
      status: response.status,
    });
  }

  return payload as SuccessEnvelope<T>;
}

/** Performs a request and returns only the `data` payload. */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const envelope = await request<T>(path, options);
  return envelope.data;
}

/** Performs a cursor-paginated GET and returns items plus the next cursor. */
export async function apiRequestPage<T>(
  path: string,
  options: RequestOptions = {},
): Promise<CursorPage<T>> {
  const envelope = await request<T[]>(path, options);
  return { items: envelope.data, nextCursor: envelope.meta?.nextCursor ?? null };
}

/** Builds a query string, omitting empty values. */
export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}

/** RFC 4122 v4 UUID for the `Idempotency-Key` header. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
