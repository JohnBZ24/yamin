import { DataSource, QueryRunner } from 'typeorm';

import {
  EntityNodeType,
  normalizeEntityName,
} from '../domain/graph-vocabulary';

/**
 * Integration tests against a real Postgres.
 *
 * These deliberately exercise SQL rather than TypeScript: every bug found in
 * the memory graph so far lived in the SQL — the ON CONFLICT target, the
 * partial unique index, the merge's dedupe, TypeORM's per-statement result
 * shapes. A mocked repository would have passed through all of them.
 *
 * Run with: docker compose up -d postgres && npm run migration:run && npm run test:int
 */
describe('entity resolution (real database)', () => {
  let ds: DataSource;
  let qr: QueryRunner;
  let userId: number;

  const uniq = (name: string) => `${name} ${process.pid}-${Date.now()}`;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST ?? 'localhost',
      port: Number(process.env.DATABASE_PORT ?? 5433),
      username: process.env.DATABASE_USERNAME ?? 'postgres',
      password: process.env.DATABASE_PASSWORD ?? '123',
      database: process.env.DATABASE_NAME ?? 'yamin_db',
    });
    await ds.initialize();

    const rows = await ds.query(
      `INSERT INTO "user" ("email", "role") VALUES ($1, 2) RETURNING "id"`,
      [`test-${process.pid}-${Date.now()}@yamin.test`],
    );
    userId = rows[0].id;
  });

  afterAll(async () => {
    // The user FK cascades, so this removes every node/relation/mention made
    // here. That cascade not existing was itself one of the bugs.
    if (userId) await ds.query(`DELETE FROM "user" WHERE "id" = $1`, [userId]);
    await ds?.destroy();
  });

  beforeEach(async () => {
    qr = ds.createQueryRunner();
    await qr.connect();
  });

  afterEach(async () => {
    await qr.release();
  });

  const resolve = async (
    type: EntityNodeType,
    name: string,
    description: string | null = null,
  ) => {
    const rows = await qr.query(
      `INSERT INTO "entity_node"
         ("userId","type","name","normalizedName","description","mentionCount","lastMentionedAt")
       VALUES ($1,$2,$3,$4,$5,0,now())
       ON CONFLICT ("userId","type","normalizedName") WHERE "deletedAt" IS NULL
       DO UPDATE SET
         "lastMentionedAt" = now(),
         "description" = COALESCE("entity_node"."description", EXCLUDED."description"),
         "updatedAt" = now()
       RETURNING *`,
      [userId, type, name, normalizeEntityName(name), description],
    );
    return rows[0];
  };

  it('returns the SAME node for the same entity mentioned twice', async () => {
    const name = uniq('Sarah Okonkwo');
    const first = await resolve(EntityNodeType.Person, name);
    const second = await resolve(EntityNodeType.Person, name);

    // The whole product: a second note about Sarah must attach to the first
    // Sarah, not create a second disconnected one.
    expect(second.id).toBe(first.id);
  });

  it('resolves case and punctuation variants to one node', async () => {
    const base = uniq('Acme Corp');
    const first = await resolve(EntityNodeType.Organization, base);
    const second = await resolve(
      EntityNodeType.Organization,
      base.toUpperCase() + '.',
    );

    expect(second.id).toBe(first.id);
  });

  it('keeps different users completely separate', async () => {
    const other = (
      await ds.query(
        `INSERT INTO "user" ("email","role") VALUES ($1, 2) RETURNING "id"`,
        [`other-${process.pid}-${Date.now()}@yamin.test`],
      )
    )[0].id;

    const name = uniq('Shared Name');
    const mine = await resolve(EntityNodeType.Person, name);
    const theirs = (
      await qr.query(
        `INSERT INTO "entity_node" ("userId","type","name","normalizedName","mentionCount")
         VALUES ($1,$2,$3,$4,0) RETURNING *`,
        [other, EntityNodeType.Person, name, normalizeEntityName(name)],
      )
    )[0];

    // Same name, same type, different people — must never collapse.
    expect(theirs.id).not.toBe(mine.id);
    await ds.query(`DELETE FROM "user" WHERE "id" = $1`, [other]);
  });

  it('keeps the first description and never overwrites it with null', async () => {
    const name = uniq('Priya');
    await resolve(EntityNodeType.Person, name, 'Owns the migration');
    const second = await resolve(EntityNodeType.Person, name, null);

    // A later passing mention must not erase what we already knew.
    expect(second.description).toBe('Owns the migration');
  });

  it('does not increment mentionCount on resolve — only a real mention does', async () => {
    const name = uniq('Counter Test');
    const first = await resolve(EntityNodeType.Person, name);
    const second = await resolve(EntityNodeType.Person, name);

    // resolve() runs once per mention *attempt*; counting here would inflate on
    // every BullMQ retry.
    expect(first.mentionCount).toBe(0);
    expect(second.mentionCount).toBe(0);
  });

  it('enforces the unique identity constraint', async () => {
    const name = uniq('Dup Test');
    await resolve(EntityNodeType.Person, name);

    await expect(
      qr.query(
        `INSERT INTO "entity_node" ("userId","type","name","normalizedName","mentionCount")
         VALUES ($1,$2,$3,$4,0)`,
        [userId, EntityNodeType.Person, name, normalizeEntityName(name)],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('lets a soft-deleted name be relearned (partial index)', async () => {
    const name = uniq('Relearn');
    const first = await resolve(EntityNodeType.Person, name);
    await qr.query(
      `UPDATE "entity_node" SET "deletedAt" = now() WHERE "id" = $1`,
      [first.id],
    );

    // The unique index is WHERE "deletedAt" IS NULL precisely so a merged-away
    // or deleted entity doesn't permanently block re-learning it.
    const again = await resolve(EntityNodeType.Person, name);
    expect(again.id).not.toBe(first.id);
  });
});

describe('mention counting (real database)', () => {
  let ds: DataSource;
  let userId: number;
  let transcriptId: number;
  let nodeId: number;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST ?? 'localhost',
      port: Number(process.env.DATABASE_PORT ?? 5433),
      username: process.env.DATABASE_USERNAME ?? 'postgres',
      password: process.env.DATABASE_PASSWORD ?? '123',
      database: process.env.DATABASE_NAME ?? 'yamin_db',
    });
    await ds.initialize();

    userId = (
      await ds.query(
        `INSERT INTO "user" ("email","role") VALUES ($1,2) RETURNING "id"`,
        [`mention-${process.pid}-${Date.now()}@yamin.test`],
      )
    )[0].id;

    transcriptId = (
      await ds.query(
        `INSERT INTO "voice_transcript" ("fileUuid","rawText","status","userId")
         VALUES (gen_random_uuid(), 'test', 'pending', $1) RETURNING "id"`,
        [userId],
      )
    )[0].id;

    nodeId = (
      await ds.query(
        `INSERT INTO "entity_node" ("userId","type","name","normalizedName","mentionCount")
         VALUES ($1,'Person','X','x',0) RETURNING "id"`,
        [userId],
      )
    )[0].id;
  });

  afterAll(async () => {
    if (userId) await ds.query(`DELETE FROM "user" WHERE "id" = $1`, [userId]);
    await ds?.destroy();
  });

  const record = async () => {
    const rows = await ds.query(
      `WITH ins AS (
         INSERT INTO "node_mention" ("nodeId","voiceTranscriptId","description")
         VALUES ($1,$2,null)
         ON CONFLICT ("nodeId","voiceTranscriptId") DO NOTHING
         RETURNING "id"
       ), bumped AS (
         UPDATE "entity_node"
            SET "mentionCount" = "mentionCount" + 1, "updatedAt" = now()
          WHERE "id" = $1 AND EXISTS (SELECT 1 FROM ins)
          RETURNING "id"
       )
       SELECT (SELECT count(*) FROM ins)::int AS inserted`,
      [nodeId, transcriptId],
    );
    return rows[0].inserted > 0;
  };

  const count = async () =>
    (
      await ds.query(
        `SELECT "mentionCount" FROM "entity_node" WHERE "id" = $1`,
        [nodeId],
      )
    )[0].mentionCount;

  it('counts a new mention exactly once', async () => {
    expect(await record()).toBe(true);
    expect(await count()).toBe(1);
  });

  it('is idempotent — a retried job must not inflate the count', async () => {
    // This is the retry case: BullMQ re-runs the whole processor, which
    // re-records every mention. The count must not move.
    expect(await record()).toBe(false);
    expect(await record()).toBe(false);
    expect(await count()).toBe(1);
  });

  it('keeps mentionCount equal to the real number of mention rows', async () => {
    const rows = await ds.query(
      `SELECT count(*)::int AS n FROM "node_mention" WHERE "nodeId" = $1`,
      [nodeId],
    );
    expect(await count()).toBe(rows[0].n);
  });
});
