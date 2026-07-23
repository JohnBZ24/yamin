import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { AiModule } from '../ai/ai.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { VoiceProcessor } from './voice.processor';
import { ReminderProcessor } from './reminder.processor';
import { VoiceInfrastructureModule } from './voice-infrastructure.module';

/**
 * The consumer half: no controllers, no gateway, no HTTP.
 *
 * `reminders-queue` is registered because VoiceProcessor produces onto it and
 * ReminderProcessor consumes from it.
 */
@Module({
  imports: [
    AiModule,
    RealtimeModule,
    VoiceInfrastructureModule,
    BullModule.registerQueue(
      { name: 'voice-processing' },
      { name: 'reminders-queue' },
    ),
  ],
  providers: [VoiceProcessor, ReminderProcessor],
})
export class VoiceWorkerModule {}
