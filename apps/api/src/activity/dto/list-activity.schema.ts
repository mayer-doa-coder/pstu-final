import { z } from 'zod';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** Query params for `GET /activity`. */
export const listActivityQuerySchema = z.object({
  type: z.enum(['TRANSFER', 'MONEY_REQUEST']).optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>;
