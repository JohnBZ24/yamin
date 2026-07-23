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
import { EntityNodeType } from '../domain/graph-vocabulary';

/**
 * A canonical entity in one user's memory graph — one row per real-world thing,
 * not one row per mention.
 *
 * This replaces the old shape, which keyed nodes to `voiceTranscriptId`: 40
 * voice notes mentioning John produced 40 unrelated John rows with no way to
 * connect them, so "what do I know about John?" was unanswerable and
 * multi-hop traversal was unimplementable. Provenance moved to `node_mention`,
 * which is what that foreign key was really expressing.
 */
@Entity({ name: 'entity_node' })
// Partial unique index: the resolution key. `WHERE "deletedAt" IS NULL` so a
// soft-deleted node doesn't permanently block re-learning that same entity.
@Index('UQ_entity_node_identity', ['userId', 'type', 'normalizedName'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class EntityNodeEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'integer', nullable: false })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: UserEntity;

  @Column({ type: 'varchar', length: 60, nullable: false })
  type: EntityNodeType;

  /** Display form, as the user said it: "Sarah Okonkwo". */
  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string;

  /** Resolution key — see normalizeEntityName(). Never shown to the user. */
  @Column({ type: 'varchar', length: 255, nullable: false })
  normalizedName: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /**
   * How many distinct notes mention this entity — a cheap salience signal for
   * ranking. Maintained by NodeMentionRepository.record(), which bumps it only
   * when a mention row is actually inserted, so a retried job can't inflate it.
   */
  @Column({ type: 'integer', nullable: false, default: 0 })
  mentionCount: number;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastMentionedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deletedAt: Date | null;
}
