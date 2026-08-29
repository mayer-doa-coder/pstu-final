import { createHash } from 'node:crypto';

/**
 * Deterministic JSON serialization: object keys are emitted in sorted order
 * at every level so two structurally-equal payloads always produce the same
 * string (and therefore the same hash), regardless of key insertion order.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
    );

  return `{${entries.join(',')}}`;
}

/**
 * SHA-256 of the canonical request payload. Stored on the idempotency record
 * so a retry with the *same* key can be checked against the *same* body:
 * a matching hash replays the original response, a differing hash is a
 * client bug and returns 409 IDEMPOTENCY_KEY_REUSED
 * (IMPLEMENTATION_GUIDE.md §1.6).
 */
export function hashRequestPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}
