import type { CookieOptions } from 'express';
import type { AppConfigService } from '../../config/app-config.service';

/**
 * Single place that decides cookie attributes for every auth cookie
 * (access token, refresh token, CSRF token).
 *
 * Dev vs. prod behavior:
 * - `secure` is tied to `NODE_ENV`, not hardcoded: local dev serves the API
 *   over plain http://localhost, and a `Secure` cookie is silently dropped
 *   by the browser on a non-HTTPS origin — so `secure: true` in dev would
 *   break login entirely. In production the API must be served over HTTPS,
 *   so `secure: true` is enforced there.
 * - `sameSite: 'lax'` is used everywhere. It still attaches the cookie on
 *   top-level GET navigation (so a user following a link stays logged in)
 *   while blocking it on cross-site POST/PUT/DELETE — the requests that
 *   matter for CSRF. Combined with the double-submit CSRF token
 *   (GET /auth/csrf) on every state-changing auth route, this is the
 *   documented CSRF defense for PRD.md §7.5.
 * - CORS (`main.ts` / `bootstrap.ts`) must echo back the *exact* browser
 *   origin (not `*`) with `credentials: true` for cookies to be sent
 *   cross-origin at all — configured via `CORS_ORIGINS` in `.env`. In dev
 *   this is `http://localhost:3000` (the Next.js app); in production it
 *   must be set to the real deployed web origin(s).
 */
export function buildCookieOptions(
  config: AppConfigService,
  options: { maxAgeMs: number; path?: string; httpOnly?: boolean },
): CookieOptions {
  return {
    httpOnly: options.httpOnly ?? true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: options.path ?? '/',
    maxAge: options.maxAgeMs,
  };
}
