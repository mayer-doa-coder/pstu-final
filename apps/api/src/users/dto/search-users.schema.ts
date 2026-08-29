import { z } from 'zod';

// Risk 10 (IMPLEMENTATION_GUIDE.md §6) — a 1-character query would match an
// unreasonably broad slice of users and turn search into an enumeration
// tool; 2 chars keeps it a genuine "find someone" lookup.
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 254;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 20;

export const searchUsersQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(MIN_QUERY_LENGTH, `Search query must be at least ${MIN_QUERY_LENGTH} characters.`)
    .max(MAX_QUERY_LENGTH),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>;
