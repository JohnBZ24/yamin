import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3 — turn the extraction dump into an actual memory graph.
 *
 * What changes and why:
 *  - `entity_node` was keyed to a transcript, so N notes about John produced N
 *    unrelated John rows. It becomes a user-scoped canonical entity, resolved
 *    on (userId, type, normalizedName).
 *  - `entity_relation` pointed at *names* via four loose strings. It now points
 *    at node ids, which is what makes traversal possible at all.
 *  - `node_mention` is new: it carries the provenance that
 *    `entity_node.voiceTranscriptId` was standing in for ("you told me this on
 *    Tuesday").
 *  - Foreign keys everywhere. There were previously NONE — deleting a user left
 *    their entire memory graph orphaned in the database forever, which is both
 *    a correctness bug and a GDPR-erasure problem for highly personal data.
 *  - HNSW index on the embedding, so search doesn't table-scan.
 *
 * DESTRUCTIVE: entity_node and entity_relation are dropped and rebuilt. The old
 * per-transcript rows cannot be backfilled into canonical entities without
 * re-running extraction (the normalized key and the constrained vocabulary
 * simply don't exist in that data). Verified before writing this: the only rows
 * present were throwaway test data from the Phase 2 end-to-end runs. If that is
 * ever untrue on an environment you care about, re-extract from
 * `voice_transcript.rawText`, which is preserved and untouched.
 */
export class MemoryGraph1784100000000 implements MigrationInterface {
  name = 'MemoryGraph1784100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- rebuild the graph tables -------------------------------------------
    await queryRunner.query(`DROP TABLE IF EXISTS "entity_relation"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "entity_node"`);

    await queryRunner.query(`
      CREATE TABLE "entity_node" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "type" character varying(60) NOT NULL,
        "name" character varying(255) NOT NULL,
        "normalizedName" character varying(255) NOT NULL,
        "description" text,
        "mentionCount" integer NOT NULL DEFAULT 0,
        "lastMentionedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_entity_node" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_entity_node_userId" ON "entity_node" ("userId")`,
    );
    // The resolution key. Partial, so a soft-deleted node doesn't permanently
    // block re-learning the same entity.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_entity_node_identity"
        ON "entity_node" ("userId", "type", "normalizedName")
        WHERE "deletedAt" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "entity_node"
        ADD CONSTRAINT "FK_entity_node_user"
        FOREIGN KEY ("userId") REFERENCES "user"("id")
        ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE TABLE "node_mention" (
        "id" SERIAL NOT NULL,
        "nodeId" integer NOT NULL,
        "voiceTranscriptId" integer NOT NULL,
        "description" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_node_mention" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_node_mention_nodeId" ON "node_mention" ("nodeId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_node_mention_transcriptId" ON "node_mention" ("voiceTranscriptId")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_node_mention"
        ON "node_mention" ("nodeId", "voiceTranscriptId")
    `);
    await queryRunner.query(`
      ALTER TABLE "node_mention"
        ADD CONSTRAINT "FK_node_mention_node"
        FOREIGN KEY ("nodeId") REFERENCES "entity_node"("id")
        ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "node_mention"
        ADD CONSTRAINT "FK_node_mention_transcript"
        FOREIGN KEY ("voiceTranscriptId") REFERENCES "voice_transcript"("id")
        ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE TABLE "entity_relation" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "sourceNodeId" integer NOT NULL,
        "targetNodeId" integer NOT NULL,
        "type" character varying(60) NOT NULL,
        "description" text,
        "voiceTranscriptId" integer,
        "mentionCount" integer NOT NULL DEFAULT 1,
        "lastMentionTranscriptId" integer,
        "lastMentionedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_entity_relation" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_entity_relation_userId" ON "entity_relation" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_entity_relation_source" ON "entity_relation" ("sourceNodeId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_entity_relation_target" ON "entity_relation" ("targetNodeId")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_entity_relation_identity"
        ON "entity_relation" ("userId", "sourceNodeId", "targetNodeId", "type")
        WHERE "deletedAt" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "entity_relation"
        ADD CONSTRAINT "FK_entity_relation_user"
        FOREIGN KEY ("userId") REFERENCES "user"("id")
        ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "entity_relation"
        ADD CONSTRAINT "FK_entity_relation_source"
        FOREIGN KEY ("sourceNodeId") REFERENCES "entity_node"("id")
        ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "entity_relation"
        ADD CONSTRAINT "FK_entity_relation_target"
        FOREIGN KEY ("targetNodeId") REFERENCES "entity_node"("id")
        ON DELETE CASCADE
    `);
    // SET NULL, not CASCADE: deleting the note you first heard a fact in must
    // not delete the fact itself.
    await queryRunner.query(`
      ALTER TABLE "entity_relation"
        ADD CONSTRAINT "FK_entity_relation_transcript"
        FOREIGN KEY ("voiceTranscriptId") REFERENCES "voice_transcript"("id")
        ON DELETE SET NULL
    `);

    // --- voice_transcript: the FK it never had ------------------------------
    await queryRunner.query(`
      DELETE FROM "voice_transcript"
       WHERE "userId" NOT IN (SELECT "id" FROM "user")
    `);
    await queryRunner.query(`
      ALTER TABLE "voice_transcript"
        ADD CONSTRAINT "FK_voice_transcript_user"
        FOREIGN KEY ("userId") REFERENCES "user"("id")
        ON DELETE CASCADE
    `);

    // --- vector search index ------------------------------------------------
    // HNSW over cosine distance. OpenAI embeddings are unit-normalised, so
    // cosine and inner product rank identically; cosine is the safe default if
    // the embedding model is ever swapped for one that isn't normalised.
    // Chosen over IVFFlat because IVFFlat needs representative data present at
    // build time to cluster well — building it on an empty table (which is
    // exactly what a migration does) produces a bad index.
    await queryRunner.query(`
      CREATE INDEX "IDX_voice_transcript_embedding_hnsw"
        ON "voice_transcript"
        USING hnsw ("embedding" vector_cosine_ops)
    `);
    // Vector search is always scoped to one user; without this the HNSW scan is
    // filtered after the fact.
    await queryRunner.query(`
      CREATE INDEX "IDX_voice_transcript_user_created"
        ON "voice_transcript" ("userId", "createdAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_voice_transcript_user_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_voice_transcript_embedding_hnsw"`,
    );
    await queryRunner.query(
      `ALTER TABLE "voice_transcript" DROP CONSTRAINT IF EXISTS "FK_voice_transcript_user"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "entity_relation"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "node_mention"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "entity_node"`);

    // Restore the pre-Phase-3 shape so `migration:revert` leaves a working
    // schema rather than a half-dropped one.
    await queryRunner.query(`
      CREATE TABLE "entity_node" (
        "id" SERIAL NOT NULL,
        "voiceTranscriptId" integer NOT NULL,
        "label" character varying(120) NOT NULL,
        "name" character varying(255) NOT NULL,
        "description" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_2cca946f6bb803ab9ca7a1fedae" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_ed253a26a07ccf943eb0bff8be" ON "entity_node" ("voiceTranscriptId")`,
    );
    await queryRunner.query(`
      CREATE TABLE "entity_relation" (
        "id" SERIAL NOT NULL,
        "voiceTranscriptId" integer NOT NULL,
        "sourceLabel" character varying(120) NOT NULL,
        "sourceName" character varying(255) NOT NULL,
        "targetLabel" character varying(120) NOT NULL,
        "targetName" character varying(255) NOT NULL,
        "type" character varying(120) NOT NULL,
        "description" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_0b8f25baa309cc0cc9b270b485c" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_e750c9e4cb0c773621c13272d7" ON "entity_relation" ("voiceTranscriptId")`,
    );
  }
}
