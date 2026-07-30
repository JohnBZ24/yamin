import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'voice_transcript' })
export class VoiceTranscriptEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'uuid', unique: true, nullable: false })
  fileUuid: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  audioUrl: string | null;

  @Column({ type: 'text', nullable: true })
  rawText: string | null;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status: string;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  /**
   * The recording's amplitude envelope: 0–100 integers, one per slice, for
   * drawing a waveform that matches what was actually said.
   *
   * Measured on the device while recording (expo-audio metering) rather than by
   * decoding the file here — the audio never passes through this server, it
   * goes straight from the client to S3, so computing it server-side would mean
   * downloading every object back and adding an ffmpeg dependency to the
   * worker. Null for anything recorded before this existed and for typed notes,
   * which have no audio at all.
   */
  @Column({ type: 'jsonb', nullable: true })
  peaks: number[] | null;

  // We define it as 'vector' for pgvector compatibility (1536 dimensions for OpenAI embeddings)
  @Column({ type: 'vector', length: 1536, nullable: true })
  embedding: number[] | null;

  @Index()
  @Column({ type: 'integer', nullable: false })
  userId: number;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deletedAt: Date | null;
}
