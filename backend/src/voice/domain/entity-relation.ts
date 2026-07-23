import { Expose } from 'class-transformer';

import { EntityRelationType } from './graph-vocabulary';

export class EntityRelation {
  @Expose()
  id: number;

  @Expose()
  userId: number;

  @Expose()
  sourceNodeId: number;

  @Expose()
  targetNodeId: number;

  @Expose()
  type: EntityRelationType;

  @Expose()
  description: string | null;

  @Expose()
  voiceTranscriptId: number | null;

  @Expose()
  mentionCount: number;

  @Expose()
  lastMentionedAt: Date | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  deletedAt?: Date | null;
}
