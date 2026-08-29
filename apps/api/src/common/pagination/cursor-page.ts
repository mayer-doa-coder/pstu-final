/**
 * Generic cursor-paginated result — matches the `CursorPage<T>` shape named
 * in IMPLEMENTATION_GUIDE.md §8 (ActivityQueryService) and the
 * `{ data, meta: { nextCursor } }` envelope from §3.1/§3.4. Returning this
 * from a controller (instead of a plain array) tells
 * ResponseEnvelopeInterceptor to put `nextCursor` in `meta` rather than in
 * `data`. Reused by any future cursor-paginated endpoint (activity, money
 * requests), not just user search.
 */
export class CursorPage<T> {
  constructor(
    public readonly data: T[],
    public readonly nextCursor: string | null,
  ) {}
}
