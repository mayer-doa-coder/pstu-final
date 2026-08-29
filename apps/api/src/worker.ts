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
  // Lets OutboxPoller stop its timer on SIGTERM instead of being killed
  // mid-drain; an interrupted event stays unprocessed and is re-claimed.
  app.enableShutdownHooks();

  logger.log('Worker process started. Draining outbox events.', 'Worker');
}

void bootstrap();
