import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { AppConfigService } from './config/app-config.service';

/**
 * HTTP pipeline setup shared by the real server (main.ts) and integration
 * tests, so tests exercise the exact same request pipeline — global prefix,
 * cookie parsing, error/response envelopes, CORS — as production.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfigService);

  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
  });
}
