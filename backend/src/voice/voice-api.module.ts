import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';

import { AiModule } from '../ai/ai.module';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { VoiceGateway } from './voice.gateway';
import { VoiceInfrastructureModule } from './voice-infrastructure.module';

/**
 * The producer half: accepts uploads, enqueues work, holds the sockets.
 *
 * Deliberately does NOT provide VoiceProcessor / ReminderProcessor. Registering
 * a @Processor is what starts a BullMQ worker, so importing them here would put
 * the API back to consuming jobs and running LLM extraction on the same event
 * loop that serves HTTP — which is exactly the bug the two-instance
 * architecture exists to prevent.
 */
@Module({
  imports: [
    AiModule,
    VoiceInfrastructureModule,
    BullModule.registerQueue({ name: 'voice-processing' }),
    JwtModule.register({}),
  ],
  controllers: [VoiceController],
  providers: [VoiceService, VoiceGateway],
  exports: [VoiceService],
})
export class VoiceApiModule {}
