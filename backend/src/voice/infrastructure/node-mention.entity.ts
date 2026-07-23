import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { EntityNodeEntity } from './entity-node.entity';
import { VoiceTranscriptEntity } from './voice-transcript.entity';

/**
 * Provenance: "this note is where I learned about this entity."
 *
 * For a product whose promise is remembering, being able to answer *where a
 * fact came from* is not optional — "you told me on Tuesday" is the difference
 * between a secretary and a guess. This is the join table that the old
 * `entity_node.voiceTranscriptId` column was standing in for.
 */
@Entity({ name: 'node_mention' })
@Index('UQ_node_mention', ['nodeId', 'voiceTranscriptId'], { unique: true })
export class NodeMentionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'integer', nullable: false })
  nodeId: number;

  @ManyToOne(() => EntityNodeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'nodeId' })
  node?: EntityNodeEntity;

  @Index()
  @Column({ type: 'integer', nullable: false })
  voiceTranscriptId: number;

  @ManyToOne(() => VoiceTranscriptEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'voiceTranscriptId' })
  voiceTranscript?: VoiceTranscriptEntity;

  /** What this specific note said about the entity, in that note's context. */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;
}
