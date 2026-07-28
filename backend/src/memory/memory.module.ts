import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AiModule } from '../ai/ai.module';
import { VoiceApiModule } from '../voice/voice-api.module';
import { VoiceInfrastructureModule } from '../voice/voice-infrastructure.module';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { MemoryRepository } from './infrastructure/memory.repository';
import { ChatMessageRepository } from './infrastructure/chat-message.repository';
import { ChatMessageEntity } from './infrastructure/chat-message.entity';
import { VoiceTranscriptEntity } from '../voice/infrastructure/voice-transcript.entity';
import { EntityNodeEntity } from '../voice/infrastructure/entity-node.entity';

/**
 * API-side only: reading memory is a request-path concern, and nothing here
 * belongs on the worker.
 */
@Module({
  imports: [
    AiModule,
    // For converse(): a "remember" chat message goes through the same
    // submitToQueue path as a typed note, so chat-remembered facts get the
    // full pipeline (embedding, extraction, reminders) instead of a fork.
    VoiceApiModule,
    // ReminderRepository: answering "what did you remind me about?" needs the
    // record of what Yamin itself scheduled, which lives on the voice side.
    VoiceInfrastructureModule,
    TypeOrmModule.forFeature([
      VoiceTranscriptEntity,
      EntityNodeEntity,
      ChatMessageEntity,
    ]),
  ],
  controllers: [MemoryController],
  providers: [MemoryService, MemoryRepository, ChatMessageRepository],
  exports: [MemoryService],
})
export class MemoryModule {}
