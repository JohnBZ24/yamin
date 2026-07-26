import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1784017045822 implements MigrationInterface {
  name = 'Init1784017045822';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "vector"`);
    await queryRunner.query(
      `CREATE TABLE "voice_transcript" ("id" SERIAL NOT NULL, "fileUuid" uuid NOT NULL, "audioUrl" character varying(1024), "rawText" text, "status" character varying(50) NOT NULL DEFAULT 'pending', "summary" text, "embedding" vector(1536), "userId" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_0c5ec6bc4ab80b354d8d2666659" UNIQUE ("fileUuid"), CONSTRAINT "PK_8a5c7ad7ccc06c66cd47df12050" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0c5ec6bc4ab80b354d8d266665" ON "voice_transcript" ("fileUuid") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_08272dfc9c829764660260e1e1" ON "voice_transcript" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "entity_relation" ("id" SERIAL NOT NULL, "voiceTranscriptId" integer NOT NULL, "sourceLabel" character varying(120) NOT NULL, "sourceName" character varying(255) NOT NULL, "targetLabel" character varying(120) NOT NULL, "targetName" character varying(255) NOT NULL, "type" character varying(120) NOT NULL, "description" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_0b8f25baa309cc0cc9b270b485c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e750c9e4cb0c773621c13272d7" ON "entity_relation" ("voiceTranscriptId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "entity_node" ("id" SERIAL NOT NULL, "voiceTranscriptId" integer NOT NULL, "label" character varying(120) NOT NULL, "name" character varying(255) NOT NULL, "description" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_2cca946f6bb803ab9ca7a1fedae" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ed253a26a07ccf943eb0bff8be" ON "entity_node" ("voiceTranscriptId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "user" ("id" SERIAL NOT NULL, "email" character varying(320), "phoneNumber" character varying(32), "password" character varying, "firstName" character varying(120), "lastName" character varying(120), "profilePicture" character varying, "role" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "isEmailVerified" boolean NOT NULL DEFAULT false, CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"), CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_58e4dbff0e1a32a9bdc861bb29" ON "user" ("firstName") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f0e1b4ecdca13b177e2e3a0613" ON "user" ("lastName") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a61cb8d191cd7e21cbce349a03" ON "user" ("deletedAt") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a61cb8d191cd7e21cbce349a03"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f0e1b4ecdca13b177e2e3a0613"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_58e4dbff0e1a32a9bdc861bb29"`,
    );
    await queryRunner.query(`DROP TABLE "user"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ed253a26a07ccf943eb0bff8be"`,
    );
    await queryRunner.query(`DROP TABLE "entity_node"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e750c9e4cb0c773621c13272d7"`,
    );
    await queryRunner.query(`DROP TABLE "entity_relation"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_08272dfc9c829764660260e1e1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0c5ec6bc4ab80b354d8d266665"`,
    );
    await queryRunner.query(`DROP TABLE "voice_transcript"`);
  }
}
