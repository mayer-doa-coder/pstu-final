import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { AppLogger } from './common/logger/app-logger.service';

async function bootstrap(): Promise<void> {
  const logger = new AppLogger();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  app.useLogger(logger);
  logger.log(
    'Worker process started. No background processors are registered yet — added in Milestone 6.',
    'Worker',
  );
}

void bootstrap();
