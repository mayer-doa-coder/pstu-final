import { z } from 'zod';
import { safeText } from '../../common/validation/safe-text';

// Money is integer minor units (poisha). Upper bound well inside
// Number.MAX_SAFE_INTEGER; non-positive amounts are rejected here and the DB
// CHECK is the last-line guard.
const MAX_AMOUNT_MINOR = 1_000_000_000_000; // BDT 10,000,000,000

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const createMoneyRequestSchema = z.object({
  payerUserId: z.string().trim().regex(UUID_PATTERN, 'payerUserId must be a valid user id.'),
  amountMinor: z
    .number()
    .int('amountMinor must be an integer number of poisha.')
    .positive('amountMinor must be greater than zero.')
    .max(MAX_AMOUNT_MINOR),
  currency: z.literal('BDT').default('BDT'),
  // Stored and shown to the payer — user-controlled text rules apply.
  note: safeText(280).optional(),
  // Optional deadline. Must be in the future; the service re-checks elapsed
  // time at accept. `null` and omitted both mean "no expiry".
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export type CreateMoneyRequestInput = z.infer<typeof createMoneyRequestSchema>;
