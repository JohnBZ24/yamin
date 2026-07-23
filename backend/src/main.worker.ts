import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { WorkerModule } from './worker.module';

/**
 * Entrypoint for the background worker instance.
 *
 * createApplicationContext (not create) — no HTTP server is started. BullMQ
 * workers begin consuming as soon as their @Processor providers are
 * instantiated, so there is nothing to "start" beyond building the context.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const logger = new Logger('Worker');

  // Without this, SIGTERM kills the process instantly: BullMQ never gets to
  // finish the job it is holding, and the job sits locked until its lock
  // expires. With it, in-flight work drains on deploy.
  app.enableShutdownHooks();

  logger.log('Background worker started and consuming queues');
}

void bootstrap();
