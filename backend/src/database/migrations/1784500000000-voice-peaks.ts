import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The waveform on a voice note, so it shows the recording instead of decorating it.
 *
 * The player drew a hardcoded ten-bar shape — the same silhouette on every note,
 * regardless of what was said. A wave that does not match its audio is worse
 * than none: it looks like information and isn't.
 *
 * The envelope is measured on the device while recording, via expo-audio's
 * metering, and sent with the note. Deliberately NOT computed here: the audio
 * never reaches this server (the client uploads straight to S3), so doing it
 * server-side would mean pulling every object back down and adding an ffmpeg
 * dependency to the worker for something the client already knows.
 *
 * jsonb rather than a numeric array: it is read as a whole and never queried
 * into, and jsonb is what the rest of this schema already reaches for.
 *
 * Nullable with no backfill — notes recorded before this have no envelope and
 * there is no way to invent one. The client falls back to the flat shape for
 * those, which is why the column can stay null forever without breaking.
 */
export class VoicePeaks1784500000000 implements MigrationInterface {
  name = 'VoicePeaks1784500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "voice_transcript" ADD COLUMN IF NOT EXISTS "peaks" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "voice_transcript" DROP COLUMN IF EXISTS "peaks"`,
    );
  }
}
