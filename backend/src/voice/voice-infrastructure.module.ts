import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { VoiceTranscriptEntity } from './infrastructure/voice-transcript.entity';
import { EntityNodeEntity } from './infrastructure/entity-node.entity';
import { EntityRelationEntity } from './infrastructure/entity-relation.entity';
import { NodeMentionEntity } from './infrastructure/node-mention.entity';
import { ReminderEntity } from './infrastructure/reminder.entity';
import { VoiceTranscriptRepository } from './infrastructure/voice-transcript.repository';
import { EntityNodeRepository } from './infrastructure/entity-node.repository';
import { EntityRelationRepository } from './infrastructure/entity-relation.repository';
import { NodeMentionRepository } from './infrastructure/node-mention.repository';
import { ReminderRepository } from './infrastructure/reminder.repository';

/**
 * Persistence only — shared by the API and worker halves, which both read and
 * write the same tables but otherwise have nothing in common.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      VoiceTranscriptEntity,
      EntityNodeEntity,
      EntityRelationEntity,
      NodeMentionEntity,
      ReminderEntity,
    ]),
  ],
  providers: [
    VoiceTranscriptRepository,
    EntityNodeRepository,
    EntityRelationRepository,
    NodeMentionRepository,
    ReminderRepository,
  ],
  exports: [
    VoiceTranscriptRepository,
    EntityNodeRepository,
    EntityRelationRepository,
    NodeMentionRepository,
    ReminderRepository,
  ],
})
export class VoiceInfrastructureModule {}
