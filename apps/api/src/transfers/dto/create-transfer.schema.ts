import { z } from 'zod';
import { safeText } from '../../common/validation/safe-text';

// Money is integer minor units (poisha). An upper bound well inside
// Number.MAX_SAFE_INTEGER keeps the value exact through JSON and arithmetic;
// non-positive amounts are rejected here as malformed input, and re-checked
// against the live balance inside the wallet lock (TransferService).
const MAX_AMOUNT_MINOR = 1_000_000_000_000; // BDT 10,000,000,000

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const createTransferSchema = z.object({
  receiverUserId: z.string().trim().regex(UUID_PATTERN, 'receiverUserId must be a valid user id.'),
  amountMinor: z
    .number()
    .int('amountMinor must be an integer number of poisha.')
    .positive('amountMinor must be greater than zero.')
    .max(MAX_AMOUNT_MINOR),
  // MVP is single-currency; accept the field for forward-compatibility but
  // pin it to BDT.
  currency: z.literal('BDT').default('BDT'),
  // Stored and shown to the recipient — user-controlled text rules apply.
  note: safeText(280).optional(),
});

export type CreateTransferInput = z.infer<typeof createTransferSchema>;
