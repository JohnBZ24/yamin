import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { UserEntity } from '../../user/infrastructure/user.entity';
import { EntityNodeEntity } from './entity-node.entity';
import { VoiceTranscriptEntity } from './voice-transcript.entity';
import { EntityRelationType } from '../domain/graph-vocabulary';

/**
 * An edge between two canonical nodes.
 *
 * Endpoints are node ids. They used to be four loose strings
 * (`sourceLabel`/`sourceName`/`targetLabel`/`targetName`), which meant an edge
 * pointed at a *name*, not a thing: nothing could be traversed without a
 * string join that the unconstrained vocabulary made unreliable anyway
 * (`Organization:Acme Corp` vs `Company:Acme Corp` — same company, no join).
 */
@Entity({ name: 'entity_relation' })
// One edge per (source, target, type) per user; repeats bump mentionCount
// rather than inserting a duplicate row every time the fact is restated.
@Index(
  'UQ_entity_relation_identity',
  ['userId', 'sourceNodeId', 'targetNodeId', 'type'],
  { unique: true, where: '"deletedAt" IS NULL' },
)
export class EntityRelationEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'integer', nullable: false })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: UserEntity;

  @Index()
  @Column({ type: 'integer', nullable: false })
  sourceNodeId: number;

  @ManyToOne(() => EntityNodeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sourceNodeId' })
  sourceNode?: EntityNodeEntity;

  @Index()
  @Column({ type: 'integer', nullable: false })
  targetNodeId: number;

  @ManyToOne(() => EntityNodeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'targetNodeId' })
  targetNode?: EntityNodeEntity;

  @Column({ type: 'varchar', length: 60, nullable: false })
  type: EntityRelationType;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /**
   * The note that first asserted this edge. SET NULL rather than CASCADE: if
   * that note is deleted the user still knows Sarah works at Acme — deleting
   * the source of a fact must not silently delete the fact.
   */
  @Column({ type: 'integer', nullable: true })
  voiceTranscriptId: number | null;

  @ManyToOne(() => VoiceTranscriptEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'voiceTranscriptId' })
  voiceTranscript?: VoiceTranscriptEntity;

  /**
   * How many distinct notes have asserted this edge.
   *
   * Guarded by `lastMentionTranscriptId` so a retried job re-asserting the same
   * edge from the same note doesn't inflate it. (Not perfectly exact across an
   * A→B→A note ordering; making it exact would need a relation_mention join
   * table, which isn't worth the weight until the count drives something
   * user-visible. Retries are the realistic inflation source and this stops
   * them.)
   */
  @Column({ type: 'integer', nullable: false, default: 1 })
  mentionCount: number;

  /** The last note that asserted this edge — the retry guard for mentionCount. */
  @Column({ type: 'integer', nullable: true })
  lastMentionTranscriptId: number | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastMentionedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deletedAt: Date | null;
}
