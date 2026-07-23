import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryRunner, Repository } from 'typeorm';

import { NodeMentionEntity } from './node-mention.entity';

export type RecordMentionInput = {
  nodeId: number;
  voiceTranscriptId: number;
  description: string | null;
};

@Injectable()
export class NodeMentionRepository {
  constructor(
    @InjectRepository(NodeMentionEntity)
    private readonly repository: Repository<NodeMentionEntity>,
  ) {}

  private getRepository(
    queryRunner?: QueryRunner,
  ): Repository<NodeMentionEntity> {
    if (queryRunner) {
      return queryRunner.manager.getRepository(NodeMentionEntity);
    }
    return this.repository;
  }

  /**
   * Record that a note mentions an entity, and keep the node's denormalised
   * `mentionCount` exact.
   *
   * DO NOTHING on conflict: a job retried after a partial failure must not
   * double-count, and one note mentioning an entity twice is still one note.
   * The count is bumped in the same statement, gated on `EXISTS (SELECT 1 FROM
   * ins)`, so it increments if and only if a row was actually inserted — the
   * two can never drift, and there's no read-modify-write window for a
   * concurrent worker to lose.
   *
   * @returns true if this was a new mention.
   */
  async record(
    data: RecordMentionInput,
    queryRunner?: QueryRunner,
  ): Promise<boolean> {
    const repository = this.getRepository(queryRunner);

    const rows = await repository.query(
      `WITH ins AS (
         INSERT INTO "node_mention" ("nodeId", "voiceTranscriptId", "description")
         VALUES ($1, $2, $3)
         ON CONFLICT ("nodeId", "voiceTranscriptId") DO NOTHING
         RETURNING "id"
       ), bumped AS (
         UPDATE "entity_node"
            SET "mentionCount" = "mentionCount" + 1,
                "updatedAt"    = now()
          WHERE "id" = $1
            AND EXISTS (SELECT 1 FROM ins)
          RETURNING "id"
       )
       SELECT (SELECT count(*) FROM ins)::int AS inserted`,
      [data.nodeId, data.voiceTranscriptId, data.description],
    );

    return (rows[0]?.inserted ?? 0) > 0;
  }
}
