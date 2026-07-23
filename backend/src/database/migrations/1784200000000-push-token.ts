import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Push tokens, so a reminder can reach a phone that isn't running the app.
 *
 * Until now the ONLY delivery path was a socket emit to whoever happened to be
 * connected. Nothing was stored: a reminder that fired while the app was closed
 * was dropped and permanently lost — no record, no retry, and the BullMQ job
 * still reported success because emitting was all it promised to do.
 *
 * One row per (user, device). A user with a phone and a tablet must get both,
 * so the key is the token rather than the user.
 */
export class PushToken1784200000000 implements MigrationInterface {
  name = 'PushToken1784200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "push_token" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "token" character varying(255) NOT NULL,
        "platform" character varying(20),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_push_token" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_push_token_token" UNIQUE ("token"),
        CONSTRAINT "FK_push_token_user" FOREIGN KEY ("userId")
          REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);

    // Every send looks up by user; without this it table-scans on each reminder.
    await queryRunner.query(
      `CREATE INDEX "IDX_push_token_user" ON "push_token" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_push_token_user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "push_token"`);
  }
}
