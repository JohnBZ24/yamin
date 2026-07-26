import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryRunner, Repository } from 'typeorm';

import { EntityNodeEntity } from '../../voice/infrastructure/entity-node.entity';
import { VoiceTranscriptEntity } from '../../voice/infrastructure/voice-transcript.entity';
import {
  EntityNodeType,
  EntityRelationType,
} from '../../voice/domain/graph-vocabulary';

export type MemoryHit = {
  id: number;
  fileUuid: string;
  summary: string | null;
  rawText: string | null;
  createdAt: Date;
  similarity: number;
};

export type EntitySummary = {
  id: number;
  type: EntityNodeType;
  name: string;
  description: string | null;
  mentionCount: number;
  lastMentionedAt: Date | null;
};

export type GraphEdge = {
  id: number;
  sourceNodeId: number;
  targetNodeId: number;
  type: EntityRelationType;
  description: string | null;
  mentionCount: number;
};

export type EntityFact = {
  relationId: number;
  type: EntityRelationType;
  direction: 'outgoing' | 'incoming';
  otherNodeId: number;
  otherNodeName: string;
  otherNodeType: EntityNodeType;
  description: string | null;
  mentionCount: number;
};

@Injectable()
export class MemoryRepository {
  constructor(
    @InjectRepository(VoiceTranscriptEntity)
    private readonly transcripts: Repository<VoiceTranscriptEntity>,
    @InjectRepository(EntityNodeEntity)
    private readonly nodes: Repository<EntityNodeEntity>,
  ) {}

  private repo(queryRunner?: QueryRunner): Repository<VoiceTranscriptEntity> {
    return queryRunner
      ? queryRunner.manager.getRepository(VoiceTranscriptEntity)
      : this.transcripts;
  }

  /**
   * Semantic search over the user's notes.
   *
   * `<=>` is pgvector cosine distance and matches the HNSW index's opclass —
   * they must agree or Postgres silently ignores the index and sequential-scans
   * every embedding.
   *
   * The `userId` filter is not optional: it is the entire authorization
   * boundary for the most sensitive data in the product. Search must never be
   * able to reach across users.
   */
  async searchByEmbedding(
    {
      userId,
      embedding,
      limit,
      minSimilarity,
    }: {
      userId: number;
      embedding: number[];
      limit: number;
      minSimilarity: number;
    },
    queryRunner?: QueryRunner,
  ): Promise<MemoryHit[]> {
    const vector = JSON.stringify(embedding);

    const rows = await this.repo(queryRunner).query(
      `SELECT "id", "fileUuid", "summary", "rawText", "createdAt",
              1 - ("embedding" <=> $1::vector) AS "similarity"
         FROM "voice_transcript"
        WHERE "userId" = $2
          AND "deletedAt" IS NULL
          AND "embedding" IS NOT NULL
          AND 1 - ("embedding" <=> $1::vector) >= $4
        ORDER BY "embedding" <=> $1::vector
        LIMIT $3`,
      [vector, userId, limit, minSimilarity],
    );

    return (rows as Array<MemoryHit & { similarity: string }>).map((row) => ({
      ...row,
      similarity: Number(row.similarity),
    }));
  }

  /**
   * The most recent notes, newest first, ignoring similarity entirely.
   *
   * Vector search answers "what did I say about X". It cannot answer "what have
   * I told you about" — a question about the corpus itself, where no single
   * note is especially similar to the phrasing and every hit scores low. That
   * question needs the notes themselves, in order, which is what this returns.
   */
  async listRecentNotes(
    { userId, limit }: { userId: number; limit: number },
    queryRunner?: QueryRunner,
  ): Promise<MemoryHit[]> {
    const rows = await this.repo(queryRunner).query(
      `SELECT "id", "fileUuid", "summary", "rawText", "createdAt", 0 AS "similarity"
         FROM "voice_transcript"
        WHERE "userId" = $1
          AND "deletedAt" IS NULL
          AND COALESCE(NULLIF(TRIM("rawText"), ''), NULLIF(TRIM("summary"), '')) IS NOT NULL
        ORDER BY "createdAt" DESC
        LIMIT $2`,
      [userId, limit],
    );

    return (rows as Array<MemoryHit & { similarity: string }>).map((row) => ({
      ...row,
      similarity: Number(row.similarity),
    }));
  }

  /** Entities mentioned by a set of notes — the graph context around a hit. */
  async findEntitiesForTranscripts(
    {
      userId,
      transcriptIds,
    }: { userId: number; transcriptIds: number[] },
    queryRunner?: QueryRunner,
  ): Promise<Array<EntitySummary & { voiceTranscriptId: number }>> {
    if (transcriptIds.length === 0) {
      return [];
    }

    const rows = await this.repo(queryRunner).query(
      `SELECT n."id", n."type", n."name", n."description",
              n."mentionCount", n."lastMentionedAt",
              m."voiceTranscriptId"
         FROM "entity_node" n
         JOIN "node_mention" m ON m."nodeId" = n."id"
        WHERE m."voiceTranscriptId" = ANY($1::int[])
          AND n."userId" = $2
          AND n."deletedAt" IS NULL`,
      [transcriptIds, userId],
    );

    return rows;
  }

  async findEntityById(
    { userId, nodeId }: { userId: number; nodeId: number },
    queryRunner?: QueryRunner,
  ): Promise<EntitySummary | null> {
    const repository = queryRunner
      ? queryRunner.manager.getRepository(EntityNodeEntity)
      : this.nodes;

    const entity = await repository.findOne({ where: { id: nodeId, userId } });
    if (!entity) return null;

    return {
      id: entity.id,
      type: entity.type,
      name: entity.name,
      description: entity.description,
      mentionCount: entity.mentionCount,
      lastMentionedAt: entity.lastMentionedAt,
    };
  }

  async searchEntitiesByName(
    {
      userId,
      normalizedQuery,
      limit,
    }: { userId: number; normalizedQuery: string; limit: number },
    queryRunner?: QueryRunner,
  ): Promise<EntitySummary[]> {
    return this.repo(queryRunner).query(
      `SELECT "id", "type", "name", "description", "mentionCount", "lastMentionedAt"
         FROM "entity_node"
        WHERE "userId" = $1
          AND "deletedAt" IS NULL
          AND "normalizedName" LIKE '%' || $2 || '%'
        ORDER BY "mentionCount" DESC, "name" ASC
        LIMIT $3`,
      [userId, normalizedQuery, limit],
    );
  }

  async listEntities(
    { userId, limit }: { userId: number; limit: number },
    queryRunner?: QueryRunner,
  ): Promise<EntitySummary[]> {
    return this.repo(queryRunner).query(
      `SELECT "id", "type", "name", "description", "mentionCount", "lastMentionedAt"
         FROM "entity_node"
        WHERE "userId" = $1
          AND "deletedAt" IS NULL
        ORDER BY "mentionCount" DESC, "lastMentionedAt" DESC NULLS LAST
        LIMIT $2`,
      [userId, limit],
    );
  }

  /**
   * Edges among a given set of nodes, for the graph view. Restricted to edges
   * whose BOTH endpoints are in the set — an edge to a node the client didn't
   * receive would render as a line into nothing.
   */
  async listEdgesAmong(
    { userId, nodeIds }: { userId: number; nodeIds: number[] },
    queryRunner?: QueryRunner,
  ): Promise<GraphEdge[]> {
    if (nodeIds.length === 0) {
      return [];
    }

    return this.repo(queryRunner).query(
      `SELECT r."id", r."sourceNodeId", r."targetNodeId", r."type",
              r."description", r."mentionCount"
         FROM "entity_relation" r
        WHERE r."userId" = $1
          AND r."deletedAt" IS NULL
          AND r."sourceNodeId" = ANY($2::int[])
          AND r."targetNodeId" = ANY($2::int[])
        ORDER BY r."mentionCount" DESC`,
      [userId, nodeIds],
    );
  }

  /**
   * Everything the user knows about one entity, in both directions.
   *
   * The UNION is why relations had to move to node ids: "who works at Acme?"
   * is an incoming-edge lookup, which was impossible when an edge pointed at a
   * name string.
   */
  async findFactsForEntity(
    { userId, nodeId }: { userId: number; nodeId: number },
    queryRunner?: QueryRunner,
  ): Promise<EntityFact[]> {
    return this.repo(queryRunner).query(
      `SELECT r."id" AS "relationId", r."type", 'outgoing' AS "direction",
              other."id" AS "otherNodeId", other."name" AS "otherNodeName",
              other."type" AS "otherNodeType",
              r."description", r."mentionCount"
         FROM "entity_relation" r
         JOIN "entity_node" other ON other."id" = r."targetNodeId"
        WHERE r."userId" = $1 AND r."sourceNodeId" = $2 AND r."deletedAt" IS NULL
          AND other."deletedAt" IS NULL
       UNION ALL
       SELECT r."id" AS "relationId", r."type", 'incoming' AS "direction",
              other."id" AS "otherNodeId", other."name" AS "otherNodeName",
              other."type" AS "otherNodeType",
              r."description", r."mentionCount"
         FROM "entity_relation" r
         JOIN "entity_node" other ON other."id" = r."sourceNodeId"
        WHERE r."userId" = $1 AND r."targetNodeId" = $2 AND r."deletedAt" IS NULL
          AND other."deletedAt" IS NULL
        ORDER BY "mentionCount" DESC`,
      [userId, nodeId],
    );
  }

  /**
   * Fold duplicate entities into one canonical node.
   *
   * Entity linking stops *new* duplicates; it can't repair the ones created
   * before it existed (e.g. `Task:pricing page` + `Product:Pricing Page`).
   * Merging is inherently the user's call — "are these the same thing?" is a
   * judgement no heuristic should make silently on someone's memories — so this
   * is an explicit operation, not a background job.
   *
   * Nothing is lost: mentions and edges are repointed at the survivor, edge
   * counts are folded into their equivalents, and the losers are soft-deleted
   * (the partial unique index ignores soft-deleted rows, so the name is free to
   * be relearned).
   *
   * MUST run inside a transaction — a partial merge leaves memories pointing at
   * a soft-deleted node, which reads as data loss to the user.
   */
  async mergeEntities(
    {
      userId,
      targetId,
      sourceIds,
    }: { userId: number; targetId: number; sourceIds: number[] },
    queryRunner: QueryRunner,
  ): Promise<{ mentionCount: number }> {
    const repository = queryRunner.manager.getRepository(EntityNodeEntity);

    // --- mentions: drop rows that would collide, repoint the rest -----------
    // 1. Sources whose note the survivor already has a mention for.
    await repository.query(
      `DELETE FROM "node_mention" dup
        WHERE dup."nodeId" = ANY($1::int[])
          AND EXISTS (
            SELECT 1 FROM "node_mention" keep
             WHERE keep."nodeId" = $2
               AND keep."voiceTranscriptId" = dup."voiceTranscriptId"
          )`,
      [sourceIds, targetId],
    );
    // 2. Sources that collide with EACH OTHER — two duplicates mentioned in the
    //    same note become the same (nodeId, voiceTranscriptId) row once
    //    repointed, and UQ_node_mention rejects the second. Step 1 misses this
    //    because it only compares against the survivor. Caught by
    //    memory.repository.int-spec.ts, not by the first live merge, which
    //    happened to have its duplicates in different notes.
    await repository.query(
      `DELETE FROM "node_mention" dup
        WHERE dup."nodeId" = ANY($1::int[])
          AND EXISTS (
            SELECT 1 FROM "node_mention" keep
             WHERE keep."nodeId" = ANY($1::int[])
               AND keep."voiceTranscriptId" = dup."voiceTranscriptId"
               AND keep."id" < dup."id"
          )`,
      [sourceIds],
    );
    await repository.query(
      `UPDATE "node_mention" SET "nodeId" = $2 WHERE "nodeId" = ANY($1::int[])`,
      [sourceIds, targetId],
    );

    // --- edges: fold counts into equivalents, then repoint ------------------
    for (const column of ['sourceNodeId', 'targetNodeId'] as const) {
      const other = column === 'sourceNodeId' ? 'targetNodeId' : 'sourceNodeId';

      // Carry the duplicate's mentionCount onto the surviving edge so merging
      // doesn't quietly erase how often a fact was restated.
      await repository.query(
        `UPDATE "entity_relation" surv
            SET "mentionCount" = surv."mentionCount" + dup."mentionCount",
                "updatedAt" = now()
           FROM "entity_relation" dup
          WHERE dup."userId" = $1 AND dup."${column}" = ANY($2::int[]) AND dup."deletedAt" IS NULL
            AND surv."userId" = $1 AND surv."${column}" = $3 AND surv."deletedAt" IS NULL
            AND surv."${other}" = dup."${other}" AND surv."type" = dup."type"`,
        [userId, sourceIds, targetId],
      );

      await repository.query(
        `DELETE FROM "entity_relation" dup
          WHERE dup."userId" = $1 AND dup."${column}" = ANY($2::int[]) AND dup."deletedAt" IS NULL
            AND EXISTS (
              SELECT 1 FROM "entity_relation" surv
               WHERE surv."userId" = $1 AND surv."${column}" = $3 AND surv."deletedAt" IS NULL
                 AND surv."${other}" = dup."${other}" AND surv."type" = dup."type"
            )`,
        [userId, sourceIds, targetId],
      );

      // Collapse edges that are duplicates of each other *within the source
      // set*. Merging two duplicates that each carry `Sarah RESPONSIBLE_FOR ->`
      // leaves two rows which, once repointed, are the same edge — and the
      // unique index rejects the second. Folding against the survivor (above)
      // doesn't catch this, because when the survivor has no equivalent edge
      // there is nothing to fold into. Found by merging real data.
      await repository.query(
        `UPDATE "entity_relation" keep
            SET "mentionCount" = keep."mentionCount" + dup."mentionCount",
                "updatedAt" = now()
           FROM "entity_relation" dup
          WHERE keep."userId" = $1 AND dup."userId" = $1
            AND keep."${column}" = ANY($2::int[]) AND dup."${column}" = ANY($2::int[])
            AND keep."deletedAt" IS NULL AND dup."deletedAt" IS NULL
            AND keep."${other}" = dup."${other}" AND keep."type" = dup."type"
            AND keep."id" < dup."id"`,
        [userId, sourceIds],
      );
      await repository.query(
        `DELETE FROM "entity_relation" dup
          WHERE dup."userId" = $1 AND dup."${column}" = ANY($2::int[]) AND dup."deletedAt" IS NULL
            AND EXISTS (
              SELECT 1 FROM "entity_relation" keep
               WHERE keep."userId" = $1 AND keep."${column}" = ANY($2::int[])
                 AND keep."deletedAt" IS NULL
                 AND keep."${other}" = dup."${other}" AND keep."type" = dup."type"
                 AND keep."id" < dup."id"
            )`,
        [userId, sourceIds],
      );

      await repository.query(
        `UPDATE "entity_relation"
            SET "${column}" = $3, "updatedAt" = now()
          WHERE "userId" = $1 AND "${column}" = ANY($2::int[]) AND "deletedAt" IS NULL`,
        [userId, sourceIds, targetId],
      );
    }

    // Merging A into B turns any A→B edge into B→B, which is meaningless.
    await repository.query(
      `DELETE FROM "entity_relation"
        WHERE "userId" = $1 AND "sourceNodeId" = $2 AND "targetNodeId" = $2`,
      [userId, targetId],
    );

    // Keep a description if the survivor lacked one but a loser had it.
    await repository.query(
      `UPDATE "entity_node" t
          SET "description" = COALESCE(t."description", (
                SELECT s."description" FROM "entity_node" s
                 WHERE s."id" = ANY($2::int[]) AND s."description" IS NOT NULL
                 LIMIT 1
              )),
              "updatedAt" = now()
        WHERE t."id" = $1`,
      [targetId, sourceIds],
    );

    await repository.query(
      `UPDATE "entity_node"
          SET "deletedAt" = now(), "updatedAt" = now()
        WHERE "id" = ANY($1::int[]) AND "userId" = $2`,
      [sourceIds, userId],
    );

    // Recomputed from the join table rather than summed — summing would double
    // count any note that mentioned both duplicates.
    await repository.query(
      `UPDATE "entity_node"
          SET "mentionCount" = (
                SELECT count(*) FROM "node_mention" WHERE "nodeId" = $1
              ),
              "updatedAt" = now()
        WHERE "id" = $1`,
      [targetId],
    );

    // Read back with a plain SELECT rather than UPDATE ... RETURNING.
    // TypeORM's .query() is inconsistent by statement type: INSERT ...
    // RETURNING yields `[{...}]`, but UPDATE ... RETURNING yields
    // `[[{...}], rowCount]`. Indexing [0] on the latter silently gives the rows
    // array, whose `.mentionCount` is undefined — the API reported 0 mentions
    // for a node the database correctly held at 3, which reads as data loss
    // right after a merge. A SELECT has one unambiguous shape.
    const rows = await repository.query(
      `SELECT "mentionCount" FROM "entity_node" WHERE "id" = $1`,
      [targetId],
    );

    return { mentionCount: rows[0]?.mentionCount ?? 0 };
  }

  /** The notes an entity was mentioned in — provenance for the UI. */
  async findMentionsForEntity(
    {
      userId,
      nodeId,
      limit,
    }: { userId: number; nodeId: number; limit: number },
    queryRunner?: QueryRunner,
  ): Promise<
    Array<{
      voiceTranscriptId: number;
      fileUuid: string;
      summary: string | null;
      description: string | null;
      createdAt: Date;
    }>
  > {
    return this.repo(queryRunner).query(
      `SELECT t."id" AS "voiceTranscriptId", t."fileUuid", t."summary",
              m."description", t."createdAt"
         FROM "node_mention" m
         JOIN "voice_transcript" t ON t."id" = m."voiceTranscriptId"
         JOIN "entity_node" n ON n."id" = m."nodeId"
        WHERE m."nodeId" = $1
          AND n."userId" = $2
          AND t."deletedAt" IS NULL
        ORDER BY t."createdAt" DESC
        LIMIT $3`,
      [nodeId, userId, limit],
    );
  }
}
