import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One Q&A turn in a chat with Yamin's memory.
 *
 * Until this table existed, /memory/ask was stateless: the answer rendered
 * once in whichever client asked and was gone — no history, no way to reopen
 * a conversation, no record of which voice notes an answer was built from.
 * For a product whose promise is remembering, its own conversations being
 * amnesiac was absurd.
 *
 * `sources` stores the fileUuid/summary/similarity of the voice notes the
 * answer cited, denormalized as jsonb: citations are a snapshot of what the
 * answer was built from AT THE TIME, and must keep rendering even after a
 * source note is deleted.
 */
@Entity({ name: 'chat_message' })
@Index('IDX_chat_message_conversation', ['userId', 'conversationUuid'])
export class ChatMessageEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'integer', nullable: false })
  userId: number;

  @Column({ type: 'uuid', nullable: false })
  conversationUuid: string;

  @Column({ type: 'text', nullable: false })
  question: string;

  @Column({ type: 'text', nullable: false })
  answer: string;

  @Column({ type: 'jsonb', nullable: false, default: () => `'[]'` })
  sources: Array<{
    fileUuid: string;
    summary: string | null;
    similarity: number;
    createdAt: string;
  }>;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;
}
