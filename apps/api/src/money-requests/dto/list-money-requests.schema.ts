import { z } from 'zod';
import { MoneyRequestStatus } from '@prisma/client';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** Query params for `GET /money-requests/incoming` and `/outgoing`. */
export const listMoneyRequestsQuerySchema = z.object({
  status: z.nativeEnum(MoneyRequestStatus).optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type ListMoneyRequestsQuery = z.infer<typeof listMoneyRequestsQuerySchema>;
