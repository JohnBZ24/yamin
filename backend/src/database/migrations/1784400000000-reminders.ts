import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reminders, so Yamin remembers the ones it set.
 *
 * A scheduled reminder used to exist ONLY as a BullMQ job in Redis. It fired,
 * the user got a notification, and then it was gone — with the job removed on
 * completion, nothing anywhere recorded that it had ever happened. So "what did
 * you remind me about?" was unanswerable, and the assistant whose entire
 * premise is remembering had no memory of its own actions. That is the gap this
 * table closes.
 *
 * The row is written BEFORE the job is enqueued, which makes the record the
 * source of truth: a reminder can exist without having fired, but it can never
 * fire without having been recorded.
 *
 * `voiceTranscriptId` is ON DELETE SET NULL rather than CASCADE — deleting the
 * note that asked for a reminder must not erase the fact that Yamin sent one.
 */
export class Reminders1784400000000 implements MigrationInterface {
  name = 'Reminders1784400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "reminder" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "voiceTranscriptId" integer,
        "title" text NOT NULL,
        "scheduledFor" TIMESTAMP WITH TIME ZONE NOT NULL,
        "timezone" character varying(64),
        "status" character varying(20) NOT NULL DEFAULT 'scheduled',
        "jobId" character varying(255),
        "deliveredDeviceCount" integer NOT NULL DEFAULT 0,
        "sentAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reminder" PRIMARY KEY ("id"),
        CONSTRAINT "FK_reminder_user" FOREIGN KEY ("userId")
          REFERENCES "user"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_reminder_transcript" FOREIGN KEY ("voiceTranscriptId")
          REFERENCES "voice_transcript"("id") ON DELETE SET NULL
      )
    `);

    // Both reads are "this user's reminders, in time order" — the AI context
    // block and the list endpoint.
    await queryRunner.query(
      `CREATE INDEX "IDX_reminder_user_time" ON "reminder" ("userId", "scheduledFor")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reminder_user_status" ON "reminder" ("userId", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_reminder_user_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_reminder_user_time"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "reminder"`);
  }
}
