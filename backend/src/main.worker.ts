import { writeFile } from 'node:fs/promises';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { WorkerModule } from './worker.module';

// Docker's healthcheck compares this file's mtime against the clock (see
// docker-compose.yml). The event loop being alive is the thing we're proving:
// a worker that hangs stops touching the file and gets restarted.
const HEARTBEAT_FILE = '/tmp/worker-heartbeat';
const HEARTBEAT_INTERVAL_MS = 15_000;

function startHeartbeat(): void {
  const touch = () =>
    writeFile(HEARTBEAT_FILE, String(Date.now())).catch(() => {
      // A failed heartbeat write (read-only fs, etc.) must never crash the
      // worker itself; the healthcheck going stale is the signal.
    });
  void touch();
  // `void touch()` rather than passing `touch` directly: setInterval expects a
  // void-returning callback, and handing it a promise-returning one is the
  // shape that normally hides an unhandled rejection.
  setInterval(() => void touch(), HEARTBEAT_INTERVAL_MS).unref();
}

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

  startHeartbeat();
  logger.log('Background worker started and consuming queues');
}

void bootstrap();
