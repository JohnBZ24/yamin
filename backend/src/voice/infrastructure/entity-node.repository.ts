import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryRunner, Repository } from 'typeorm';

import { EntityNode } from '../domain/entity-node';
import { EntityNodeType } from '../domain/graph-vocabulary';
import { EntityNodeEntity } from './entity-node.entity';
import { EntityNodeMapper } from './entity-node.mapper';

export type ResolveNodeInput = {
  userId: number;
  type: EntityNodeType;
  name: string;
  normalizedName: string;
  description: string | null;
};

@Injectable()
export class EntityNodeRepository {
  constructor(
    @InjectRepository(EntityNodeEntity)
    private readonly repository: Repository<EntityNodeEntity>,
  ) {}

  private getRepository(queryRunner?: QueryRunner): Repository<EntityNodeEntity> {
    if (queryRunner) {
      return queryRunner.manager.getRepository(EntityNodeEntity);
    }
    return this.repository;
  }

  /**
   * Entity resolution: find the user's existing node for this thing, or create
   * it. Returns the canonical node either way.
   *
   * A single atomic INSERT ... ON CONFLICT rather than SELECT-then-INSERT.
   * With several workers running concurrently, the read-then-write version
   * loses the race and throws a unique violation, which fails the job — and a
   * BullMQ retry re-runs the *whole* processor, paying for the embedding and
   * both LLM calls a second time. This cannot lose that race.
   *
   * `description` uses COALESCE so the first real description sticks: later
   * notes mentioning the same entity in passing (description null) must not
   * erase what we already know about them.
   *
   * Deliberately does NOT touch `mentionCount` — this runs once per mention
   * *attempt*, so incrementing here would inflate the count every time a job
   * retried. NodeMentionRepository.record() owns that counter and only bumps it
   * when a mention row is genuinely new.
   */
  async resolve(
    data: ResolveNodeInput,
    queryRunner?: QueryRunner,
  ): Promise<EntityNode> {
    const repository = this.getRepository(queryRunner);

    const rows = await repository.query(
      `INSERT INTO "entity_node"
         ("userId", "type", "name", "normalizedName", "description", "mentionCount", "lastMentionedAt")
       VALUES ($1, $2, $3, $4, $5, 0, now())
       ON CONFLICT ("userId", "type", "normalizedName") WHERE "deletedAt" IS NULL
       DO UPDATE SET
         "lastMentionedAt" = now(),
         "description"     = COALESCE("entity_node"."description", EXCLUDED."description"),
         "updatedAt"       = now()
       RETURNING *`,
      [data.userId, data.type, data.name, data.normalizedName, data.description],
    );

    return EntityNodeMapper.toDomain(rows[0] as EntityNodeEntity);
  }

  async findByTranscriptId(
    voiceTranscriptId: number,
    queryRunner?: QueryRunner,
  ): Promise<EntityNode[]> {
    const repository = this.getRepository(queryRunner);
    // Nodes are no longer owned by a transcript — they're reached through the
    // mentions join, since one node is now shared across every note that
    // mentions it.
    const rows = await repository.query(
      `SELECT n.* FROM "entity_node" n
         JOIN "node_mention" m ON m."nodeId" = n."id"
        WHERE m."voiceTranscriptId" = $1
          AND n."deletedAt" IS NULL`,
      [voiceTranscriptId],
    );
    return (rows as EntityNodeEntity[]).map((row) =>
      EntityNodeMapper.toDomain(row),
    );
  }

  async findByUser(
    userId: number,
    queryRunner?: QueryRunner,
  ): Promise<EntityNode[]> {
    const repository = this.getRepository(queryRunner);
    const entities = await repository.find({
      where: { userId },
      order: { mentionCount: 'DESC', name: 'ASC' },
    });
    return entities.map((entity) => EntityNodeMapper.toDomain(entity));
  }

  /**
   * The entities the user already talks about, for entity *linking* — shown to
   * the extractor so it reuses a canonical name instead of coining a new one.
   *
   * Ordered by salience (mentionCount, then recency) and capped, because this
   * goes into every extraction prompt: unbounded, it would grow the token bill
   * of every voice note in proportion to the user's lifetime history.
   */
  async findLinkingCandidates(
    { userId, limit }: { userId: number; limit: number },
    queryRunner?: QueryRunner,
  ): Promise<Array<{ type: string; name: string }>> {
    const repository = this.getRepository(queryRunner);
    // TimeReference is deliberately excluded. This list is handed to the
    // extractor with "reuse the EXACT name — do not invent a variant", which is
    // correct for a person or a project and destructive for a clock time:
    // verified live, a note asking for a reminder at 3:39 reused the existing
    // "3:19" node from an earlier note and recorded the wrong time. Times are
    // per-note by nature and must never be resolved onto each other.
    return repository.query(
      `SELECT "type", "name"
         FROM "entity_node"
        WHERE "userId" = $1
          AND "deletedAt" IS NULL
          AND "type" <> 'TimeReference'
        ORDER BY "mentionCount" DESC, "lastMentionedAt" DESC NULLS LAST
        LIMIT $2`,
      [userId, limit],
    );
  }
}
