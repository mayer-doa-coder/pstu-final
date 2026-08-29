import { z } from 'zod';
import { safeText } from '../../common/validation/safe-text';

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
  // Shown to other users in search results and activity, so it goes through
  // the shared user-controlled-text rules.
  displayName: safeText(120).refine((value) => value.length > 0, {
    message: 'displayName is required.',
  }),
});

export type RegisterInput = z.infer<typeof registerSchema>;
