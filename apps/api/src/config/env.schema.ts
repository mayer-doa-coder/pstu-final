import { z } from 'zod';

/**
 * Single source of truth for required runtime configuration. The app must
 * fail fast at boot if any of this is missing or malformed — per
 * IMPLEMENTATION_GUIDE.md Milestone 0 ("Configure environment validation"),
 * a money-movement service should never start in a partially-configured
 * state.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Auth — no default for the JWT secret: a money-movement service must
  // never boot with a guessable/shared signing key.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  // Wallet — PRD.md §7.7 Ambiguity A: configurable seed balance, default
  // demo value BDT 100,000 = 10,000,000 poisha.
  INITIAL_WALLET_BALANCE_MINOR: z.coerce.number().int().nonnegative().default(10_000_000),

  // Per-user rolling send limits (TransactionLimitService). Defaults are
  // generous relative to the seed wallet balance — real ceilings, not a
  // demo tripwire — and independent of each other: a transfer must fit
  // under all three simultaneously.
  DAILY_TRANSFER_LIMIT_MINOR: z.coerce.number().int().positive().default(100_000_000), // BDT 1,000,000
  WEEKLY_TRANSFER_LIMIT_MINOR: z.coerce.number().int().positive().default(300_000_000), // BDT 3,000,000
  MONTHLY_TRANSFER_LIMIT_MINOR: z.coerce.number().int().positive().default(1_000_000_000), // BDT 10,000,000

  // Risk engine — entirely optional. The deterministic score/level/reasons
  // work with no key at all; this only unlocks the plain-language LLM
  // explanation for HIGH-risk transfers (AiExplanationService no-ops without
  // it, never blocking or degrading the risk engine itself). No `.min(1)`:
  // Docker Compose interpolates an unset host variable as an empty string
  // rather than omitting the key, and an empty string must still validate —
  // AiExplanationService treats it the same as "not configured".
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(rawEnv: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(rawEnv);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }

  return result.data;
}
