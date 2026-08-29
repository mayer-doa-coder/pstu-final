import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { AppConfigService } from './config/app-config.service';
import { AppLogger } from './common/logger/app-logger.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(new AppLogger());
  configureApp(app);

  const config = app.get(AppConfigService);
  await app.listen(config.port);
}

void bootstrap();
