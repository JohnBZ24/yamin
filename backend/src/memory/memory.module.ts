import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AiModule } from '../ai/ai.module';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { MemoryRepository } from './infrastructure/memory.repository';
import { VoiceTranscriptEntity } from '../voice/infrastructure/voice-transcript.entity';
import { EntityNodeEntity } from '../voice/infrastructure/entity-node.entity';

/**
 * API-side only: reading memory is a request-path concern, and nothing here
 * belongs on the worker.
 */
@Module({
  imports: [
    AiModule,
    TypeOrmModule.forFeature([VoiceTranscriptEntity, EntityNodeEntity]),
  ],
  controllers: [MemoryController],
  providers: [MemoryService, MemoryRepository],
  exports: [MemoryService],
})
export class MemoryModule {}
