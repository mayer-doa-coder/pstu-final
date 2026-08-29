// Opaque cursor = base64url of the anchor row's id. Callers must treat it
// as opaque (IMPLEMENTATION_GUIDE.md §3.4); this encoding just avoids
// exposing a raw, guessable id shape in the wire format.
export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64url').toString('utf8');
}
