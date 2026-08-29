import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import express from 'express';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { AppConfigService } from './config/app-config.service';

/**
 * Every endpoint here takes a small JSON document (the largest is a transfer
 * with a 280-character note). A tight cap means an oversized body is rejected
 * by the parser before it can occupy memory or reach a handler.
 */
const MAX_REQUEST_BODY = '32kb';

/**
 * HTTP pipeline setup shared by the real server (main.ts) and integration
 * tests, so tests exercise the exact same request pipeline — global prefix,
 * body limits, cookie parsing, error/response envelopes, CORS — as production.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfigService);

  app.setGlobalPrefix('api/v1');
  app.use(express.json({ limit: MAX_REQUEST_BODY }));
  app.use(express.urlencoded({ extended: false, limit: MAX_REQUEST_BODY }));
  app.use(cookieParser());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());

  // Explicit allow-list from CORS_ORIGINS, never `*`: `credentials: true`
  // requires an exact origin echo, and an unrestricted origin on a
  // cookie-authenticated API would hand any site the user's session.
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key', 'X-Request-Id'],
    maxAge: 600,
  });
}
