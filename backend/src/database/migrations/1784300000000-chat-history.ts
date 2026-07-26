import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chat history, so a conversation with Yamin survives the screen it happened
 * on. /memory/ask used to be stateless — every answer vanished on navigation,
 * which made the "ask" half of the product feel like a demo. One row per Q&A
 * turn; turns sharing a conversationUuid are one conversation.
 *
 * `sources` is a denormalized jsonb snapshot of the voice notes the answer
 * cited. Deliberately NOT a foreign key: deleting a voice note must not
 * delete—or break—the chat turns that once cited it.
 */
export class ChatHistory1784300000000 implements MigrationInterface {
  name = 'ChatHistory1784300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "chat_message" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "conversationUuid" uuid NOT NULL,
        "question" text NOT NULL,
        "answer" text NOT NULL,
        "sources" jsonb NOT NULL DEFAULT '[]',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_message" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_message_user" FOREIGN KEY ("userId")
          REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_chat_message_user" ON "chat_message" ("userId")`,
    );
    // Both the conversation view (all turns of one uuid) and the list view
    // (latest turn per uuid) filter on this pair.
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_message_conversation" ON "chat_message" ("userId", "conversationUuid")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chat_message_conversation"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chat_message_user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_message"`);
  }
}
