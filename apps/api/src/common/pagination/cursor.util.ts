// Opaque cursor = base64url of the anchor row's id. Callers must treat it
// as opaque (IMPLEMENTATION_GUIDE.md §3.4); this encoding just avoids
// exposing a raw, guessable id shape in the wire format.
export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64url').toString('utf8');
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keyset cursor for lists ordered by `(created_at DESC, id DESC)` — activity
 * and money-request lists. Both halves are needed: `created_at` alone is not
 * unique, so `id` is the tiebreaker that makes paging stable when rows share
 * a timestamp (IMPLEMENTATION_GUIDE.md §3.4 / §8).
 */
export interface KeysetCursor {
  createdAt: Date;
  id: string;
}

export function encodeKeysetCursor(anchor: KeysetCursor): string {
  return Buffer.from(`${anchor.createdAt.toISOString()}|${anchor.id}`, 'utf8').toString(
    'base64url',
  );
}

/** Returns null for any malformed/tampered cursor so callers can 400 cleanly. */
export function decodeKeysetCursor(cursor: string): KeysetCursor | null {
  const [iso, id, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!iso || !id || rest.length > 0 || !UUID_PATTERN.test(id)) {
    return null;
  }
  const createdAt = new Date(iso);
  return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
}
