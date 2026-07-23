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
