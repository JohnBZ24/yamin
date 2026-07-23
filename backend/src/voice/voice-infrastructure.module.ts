import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { VoiceTranscriptEntity } from './infrastructure/voice-transcript.entity';
import { EntityNodeEntity } from './infrastructure/entity-node.entity';
import { EntityRelationEntity } from './infrastructure/entity-relation.entity';
import { NodeMentionEntity } from './infrastructure/node-mention.entity';
import { VoiceTranscriptRepository } from './infrastructure/voice-transcript.repository';
import { EntityNodeRepository } from './infrastructure/entity-node.repository';
import { EntityRelationRepository } from './infrastructure/entity-relation.repository';
import { NodeMentionRepository } from './infrastructure/node-mention.repository';

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
    ]),
  ],
  providers: [
    VoiceTranscriptRepository,
    EntityNodeRepository,
    EntityRelationRepository,
    NodeMentionRepository,
  ],
  exports: [
    VoiceTranscriptRepository,
    EntityNodeRepository,
    EntityRelationRepository,
    NodeMentionRepository,
  ],
})
export class VoiceInfrastructureModule {}
