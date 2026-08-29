import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Baseline security response headers, written explicitly rather than pulled
 * from a middleware package so a reviewer can see exactly what is set and why.
 *
 * This service returns only JSON to a separate browser origin, which shapes
 * the choices: there is no HTML to frame or sniff, so the policies can be
 * maximally restrictive.
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    // Stop a browser from second-guessing our `application/json` and
    // executing a response as script.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // The API renders no HTML, so nothing here should ever be framed —
    // clickjacking defense for any accidental HTML error page.
    res.setHeader('X-Frame-Options', 'DENY');

    // Belt-and-braces with X-Frame-Options, and blocks any resource loading
    // if a response is ever interpreted as a document.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );

    // Don't leak API paths (which contain transfer/request ids) to third
    // parties via the Referer header.
    res.setHeader('Referrer-Policy', 'no-referrer');

    // This is a JSON API; no reason for it to be granted device capabilities.
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');

    // Financial responses must never be stored by a shared or browser cache.
    res.setHeader('Cache-Control', 'no-store');

    // Force HTTPS for a year once the site has been reached over it. Only in
    // production: sending HSTS from a local http://localhost dev server would
    // poison the browser for every other localhost project.
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // Express advertises itself by default; no reason to hand out the stack.
    res.removeHeader('X-Powered-By');

    next();
  }
}
