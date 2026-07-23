import { Module } from '@nestjs/common';

import { CoreModule } from './core.module';
import { VoiceWorkerModule } from './voice/voice-worker.module';

/**
 * Root module for the background worker (the consumer).
 *
 * No controllers, no gateway, no Swagger — this process never serves HTTP. It
 * is free to block its event loop on embedding and extraction calls without
 * affecting API latency, which is the entire reason it exists as a separate
 * instance.
 */
@Module({
  imports: [CoreModule, VoiceWorkerModule],
})
export class WorkerModule {}
