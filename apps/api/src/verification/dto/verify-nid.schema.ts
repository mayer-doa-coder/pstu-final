import { z } from 'zod';
import { NID_PATTERN } from '../nid.util';

export const verifyNidSchema = z.object({
  nidNumber: z.string().trim().regex(NID_PATTERN, 'nidNumber must be a valid 10 or 17 digit NID.'),
});

export type VerifyNidInput = z.infer<typeof verifyNidSchema>;
