import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryRunner, Repository } from 'typeorm';

import { EntityRelation } from '../domain/entity-relation';
import { EntityRelationType } from '../domain/graph-vocabulary';
import { EntityRelationEntity } from './entity-relation.entity';
import { EntityRelationMapper } from './entity-relation.mapper';

export type ResolveRelationInput = {
  userId: number;
  sourceNodeId: number;
  targetNodeId: number;
  type: EntityRelationType;
  description: string | null;
  voiceTranscriptId: number | null;
};

@Injectable()
export class EntityRelationRepository {
  constructor(
    @InjectRepository(EntityRelationEntity)
    private readonly repository: Repository<EntityRelationEntity>,
  ) {}

  private getRepository(
    queryRunner?: QueryRunner,
  ): Repository<EntityRelationEntity> {
    if (queryRunner) {
      return queryRunner.manager.getRepository(EntityRelationEntity);
    }
    return this.repository;
  }

  /**
   * Upsert an edge. Restating a known fact bumps `mentionCount` instead of
   * inserting a duplicate row — otherwise every note repeating "Sarah works at
   * Acme" would add another identical edge and traversal would return the same
   * fact N times.
   *
   * `voiceTranscriptId` is only set on first insert, so it keeps meaning "the
   * note where I first learned this".
   */
  async resolve(
    data: ResolveRelationInput,
    queryRunner?: QueryRunner,
  ): Promise<EntityRelation> {
    const repository = this.getRepository(queryRunner);

    const rows = await repository.query(
      `INSERT INTO "entity_relation"
         ("userId", "sourceNodeId", "targetNodeId", "type", "description",
          "voiceTranscriptId", "mentionCount", "lastMentionedAt",
          "lastMentionTranscriptId")
       VALUES ($1, $2, $3, $4, $5, $6, 1, now(), $6)
       ON CONFLICT ("userId", "sourceNodeId", "targetNodeId", "type")
         WHERE "deletedAt" IS NULL
       DO UPDATE SET
         -- Only count a restatement from a *different* note, so a retried job
         -- re-asserting the same edge can't inflate the counter.
         "mentionCount"    = "entity_relation"."mentionCount" + (
           CASE
             WHEN "entity_relation"."lastMentionTranscriptId" IS DISTINCT FROM EXCLUDED."lastMentionTranscriptId"
             THEN 1 ELSE 0
           END
         ),
         "lastMentionTranscriptId" = EXCLUDED."lastMentionTranscriptId",
         "lastMentionedAt" = now(),
         "description"     = COALESCE("entity_relation"."description", EXCLUDED."description"),
         "updatedAt"       = now()
       RETURNING *`,
      [
        data.userId,
        data.sourceNodeId,
        data.targetNodeId,
        data.type,
        data.description,
        data.voiceTranscriptId,
      ],
    );

    return EntityRelationMapper.toDomain(rows[0] as EntityRelationEntity);
  }

  async findByTranscriptId(
    voiceTranscriptId: number,
    queryRunner?: QueryRunner,
  ): Promise<EntityRelation[]> {
    const repository = this.getRepository(queryRunner);
    const entities = await repository.find({ where: { voiceTranscriptId } });
    return entities.map((entity) => EntityRelationMapper.toDomain(entity));
  }
}
