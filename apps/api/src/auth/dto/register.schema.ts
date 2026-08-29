import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(120),
});

export type RegisterInput = z.infer<typeof registerSchema>;
