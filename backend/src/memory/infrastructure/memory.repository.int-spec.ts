import { DataSource, QueryRunner } from 'typeorm';

import { MemoryRepository } from './memory.repository';
import { EntityNodeEntity } from '../../voice/infrastructure/entity-node.entity';
import { EntityRelationEntity } from '../../voice/infrastructure/entity-relation.entity';
import { NodeMentionEntity } from '../../voice/infrastructure/node-mention.entity';
import { VoiceTranscriptEntity } from '../../voice/infrastructure/voice-transcript.entity';
import { UserEntity } from '../../user/infrastructure/user.entity';

/**
 * Merge, against a real database.
 *
 * The first live merge failed with a unique-constraint violation that no
 * typecheck or mock could have caught, so these lock that behaviour down.
 */
describe('MemoryRepository.mergeEntities (real database)', () => {
  let ds: DataSource;
  let repo: MemoryRepository;
  let qr: QueryRunner;
  let userId: number;
  let transcriptA: number;
  let transcriptB: number;

  const node = async (type: string, name: string) =>
    (
      await ds.query(
        `INSERT INTO "entity_node" ("userId","type","name","normalizedName","mentionCount")
         VALUES ($1,$2,$3,$4,0) RETURNING "id"`,
        [userId, type, name, name.toLowerCase()],
      )
    )[0].id as number;

  const mention = (nodeId: number, transcriptId: number) =>
    ds.query(
      `INSERT INTO "node_mention" ("nodeId","voiceTranscriptId") VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [nodeId, transcriptId],
    );

  const edge = (source: number, target: number, type: string, count = 1) =>
    ds.query(
      `INSERT INTO "entity_relation"
         ("userId","sourceNodeId","targetNodeId","type","mentionCount","voiceTranscriptId")
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, source, target, type, count, transcriptA],
    );

  const liveNodes = async () =>
    ds.query(
      `SELECT "id","name","mentionCount" FROM "entity_node"
        WHERE "userId" = $1 AND "deletedAt" IS NULL ORDER BY "id"`,
      [userId],
    );

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST ?? 'localhost',
      port: Number(process.env.DATABASE_PORT ?? 5433),
      username: process.env.DATABASE_USERNAME ?? 'postgres',
      password: process.env.DATABASE_PASSWORD ?? '123',
      database: process.env.DATABASE_NAME ?? 'yamin_db',
      // The full relation graph, not just the two entities used directly:
      // EntityNodeEntity has a ManyToOne to UserEntity, and TypeORM refuses to
      // build metadata for a relation whose target isn't registered.
      entities: [
        UserEntity,
        VoiceTranscriptEntity,
        EntityNodeEntity,
        EntityRelationEntity,
        NodeMentionEntity,
      ],
    });
    await ds.initialize();

    repo = new MemoryRepository(
      ds.getRepository(VoiceTranscriptEntity),
      ds.getRepository(EntityNodeEntity),
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    userId = (
      await ds.query(
        `INSERT INTO "user" ("email","role") VALUES ($1,2) RETURNING "id"`,
        [
          `merge-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@yamin.test`,
        ],
      )
    )[0].id;

    const t = async () =>
      (
        await ds.query(
          `INSERT INTO "voice_transcript" ("fileUuid","rawText","status","userId")
           VALUES (gen_random_uuid(),'t','processed',$1) RETURNING "id"`,
          [userId],
        )
      )[0].id as number;

    transcriptA = await t();
    transcriptB = await t();

    qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
  });

  afterEach(async () => {
    if (qr.isTransactionActive) await qr.commitTransaction();
    await qr.release();
    await ds.query(`DELETE FROM "user" WHERE "id" = $1`, [userId]);
  });

  it('folds duplicates into the survivor and soft-deletes the losers', async () => {
    const keep = await node('Product', 'Pricing Page');
    const dupA = await node('Task', 'pricing page');
    const dupB = await node('Task', 'Pricing Page Completion');

    await mention(keep, transcriptA);
    await mention(dupA, transcriptB);
    await mention(dupB, transcriptB);

    await repo.mergeEntities(
      { userId, targetId: keep, sourceIds: [dupA, dupB] },
      qr,
    );
    await qr.commitTransaction();

    const live = await liveNodes();
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(keep);
    // Two distinct notes mentioned this thing — NOT three. Summing the
    // duplicates' counts would double-count transcriptB, which mentioned both.
    expect(live[0].mentionCount).toBe(2);
  });

  it('REGRESSION: merges duplicates that each carry the same edge', async () => {
    // The exact live failure. Two duplicates both had
    // `Sarah -[RESPONSIBLE_FOR]->` and the survivor had no equivalent edge, so
    // repointing produced two identical rows and hit UQ_entity_relation_identity.
    const sarah = await node('Person', 'Sarah');
    const keep = await node('Product', 'Pricing Page');
    const dupA = await node('Task', 'pricing page');
    const dupB = await node('Task', 'Pricing Page Completion');

    await edge(sarah, dupA, 'RESPONSIBLE_FOR');
    await edge(sarah, dupB, 'RESPONSIBLE_FOR');

    await expect(
      repo.mergeEntities(
        { userId, targetId: keep, sourceIds: [dupA, dupB] },
        qr,
      ),
    ).resolves.toBeDefined();
    await qr.commitTransaction();

    const edges = await ds.query(
      `SELECT "sourceNodeId","targetNodeId","type","mentionCount"
         FROM "entity_relation" WHERE "userId" = $1 AND "deletedAt" IS NULL`,
      [userId],
    );
    // Collapsed to one edge, with both restatements counted.
    expect(edges).toHaveLength(1);
    expect(edges[0].targetNodeId).toBe(keep);
    expect(edges[0].mentionCount).toBe(2);
  });

  it('folds an edge count into an equivalent edge the survivor already has', async () => {
    const sarah = await node('Person', 'Sarah');
    const keep = await node('Product', 'Pricing Page');
    const dup = await node('Task', 'pricing page');

    await edge(sarah, keep, 'RESPONSIBLE_FOR', 1);
    await edge(sarah, dup, 'RESPONSIBLE_FOR', 3);

    await repo.mergeEntities({ userId, targetId: keep, sourceIds: [dup] }, qr);
    await qr.commitTransaction();

    const edges = await ds.query(
      `SELECT "mentionCount" FROM "entity_relation"
        WHERE "userId" = $1 AND "deletedAt" IS NULL`,
      [userId],
    );
    expect(edges).toHaveLength(1);
    // Merging must not silently discard how often a fact was restated.
    expect(edges[0].mentionCount).toBe(4);
  });

  it('drops self-loops created by the merge', async () => {
    const keep = await node('Product', 'Pricing Page');
    const dup = await node('Task', 'pricing page');
    // A→B becomes B→B once A is merged into B, which is meaningless.
    await edge(keep, dup, 'RELATED_TO');

    await repo.mergeEntities({ userId, targetId: keep, sourceIds: [dup] }, qr);
    await qr.commitTransaction();

    const edges = await ds.query(
      `SELECT * FROM "entity_relation" WHERE "userId" = $1 AND "deletedAt" IS NULL`,
      [userId],
    );
    expect(edges).toHaveLength(0);
  });

  it('repoints incoming edges so traversal still finds the survivor', async () => {
    const acme = await node('Organization', 'Acme');
    const keep = await node('Product', 'Pricing Page');
    const dup = await node('Task', 'pricing page');
    await edge(acme, dup, 'OWNS');

    await repo.mergeEntities({ userId, targetId: keep, sourceIds: [dup] }, qr);
    await qr.commitTransaction();

    const facts = await repo.findFactsForEntity({ userId, nodeId: keep });
    expect(facts).toHaveLength(1);
    expect(facts[0].direction).toBe('incoming');
    expect(facts[0].otherNodeName).toBe('Acme');
  });

  it('inherits a description when the survivor has none', async () => {
    const keep = await node('Product', 'Pricing Page');
    const dup = await node('Task', 'pricing page');
    await ds.query(
      `UPDATE "entity_node" SET "description" = $1 WHERE "id" = $2`,
      ['The public pricing page', dup],
    );

    await repo.mergeEntities({ userId, targetId: keep, sourceIds: [dup] }, qr);
    await qr.commitTransaction();

    const row = await ds.query(
      `SELECT "description" FROM "entity_node" WHERE "id" = $1`,
      [keep],
    );
    expect(row[0].description).toBe('The public pricing page');
  });

  it("reports the survivor's true mentionCount", async () => {
    // Regression: this returned 0 while the database held the correct value,
    // because TypeORM's UPDATE ... RETURNING yields [rows, count], not rows —
    // so the API told the user their memories had vanished.
    const keep = await node('Product', 'Pricing Page');
    const dup = await node('Task', 'pricing page');
    await mention(keep, transcriptA);
    await mention(dup, transcriptB);

    const result = await repo.mergeEntities(
      { userId, targetId: keep, sourceIds: [dup] },
      qr,
    );
    await qr.commitTransaction();

    const actual = (
      await ds.query(
        `SELECT "mentionCount" FROM "entity_node" WHERE "id" = $1`,
        [keep],
      )
    )[0].mentionCount;

    expect(result.mentionCount).toBe(2);
    expect(result.mentionCount).toBe(actual);
  });
});

describe('MemoryRepository search scoping (real database)', () => {
  let ds: DataSource;
  let repo: MemoryRepository;
  let userA: number;
  let userB: number;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST ?? 'localhost',
      port: Number(process.env.DATABASE_PORT ?? 5433),
      username: process.env.DATABASE_USERNAME ?? 'postgres',
      password: process.env.DATABASE_PASSWORD ?? '123',
      database: process.env.DATABASE_NAME ?? 'yamin_db',
      // The full relation graph, not just the two entities used directly:
      // EntityNodeEntity has a ManyToOne to UserEntity, and TypeORM refuses to
      // build metadata for a relation whose target isn't registered.
      entities: [
        UserEntity,
        VoiceTranscriptEntity,
        EntityNodeEntity,
        EntityRelationEntity,
        NodeMentionEntity,
      ],
    });
    await ds.initialize();
    repo = new MemoryRepository(
      ds.getRepository(VoiceTranscriptEntity),
      ds.getRepository(EntityNodeEntity),
    );

    const mkUser = async (tag: string) =>
      (
        await ds.query(
          `INSERT INTO "user" ("email","role") VALUES ($1,2) RETURNING "id"`,
          [`scope-${tag}-${process.pid}-${Date.now()}@yamin.test`],
        )
      )[0].id as number;

    userA = await mkUser('a');
    userB = await mkUser('b');

    // Give B a note with a known embedding; A has nothing.
    const vector = JSON.stringify(Array.from({ length: 1536 }, () => 0.01));
    await ds.query(
      `INSERT INTO "voice_transcript" ("fileUuid","rawText","status","userId","embedding")
       VALUES (gen_random_uuid(), 'B private secret', 'processed', $1, $2::vector)`,
      [userB, vector],
    );
  });

  afterAll(async () => {
    for (const id of [userA, userB]) {
      if (id) await ds.query(`DELETE FROM "user" WHERE "id" = $1`, [id]);
    }
    await ds?.destroy();
  });

  it("never returns another user's memories", async () => {
    const embedding = Array.from({ length: 1536 }, () => 0.01);

    const asB = await repo.searchByEmbedding({
      userId: userB,
      embedding,
      limit: 10,
      minSimilarity: 0,
    });
    const asA = await repo.searchByEmbedding({
      userId: userA,
      embedding,
      limit: 10,
      minSimilarity: 0,
    });

    // Identical query vector. The ONLY thing separating these two results is
    // the userId filter — the authorization boundary for the most sensitive
    // data in the product.
    expect(asB.length).toBe(1);
    expect(asA.length).toBe(0);
  });
});
