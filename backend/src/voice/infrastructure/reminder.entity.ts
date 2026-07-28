import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Where a reminder is in its life. Never deleted — a sent one IS the record. */
export type ReminderStatus = 'scheduled' | 'sent' | 'failed';

/**
 * One reminder Yamin scheduled for a user.
 *
 * Reminders used to live only as BullMQ jobs, which are removed once they run.
 * Yamin therefore had no idea what it had reminded anyone about — the one thing
 * it does unprompted was also the one thing it could not recall. This row is
 * written before the job is enqueued and updated when it fires, so the history
 * survives the queue.
 */
@Entity({ name: 'reminder' })
@Index('IDX_reminder_user_time', ['userId', 'scheduledFor'])
@Index('IDX_reminder_user_status', ['userId', 'status'])
export class ReminderEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer', nullable: false })
  userId: number;

  /**
   * The note that asked for it, when there was one. Nullable and detached
   * rather than cascaded on delete: removing the note must not erase the fact
   * that Yamin sent the reminder.
   */
  @Column({ type: 'integer', nullable: true })
  voiceTranscriptId: number | null;

  @Column({ type: 'text', nullable: false })
  title: string;

  @Column({ type: 'timestamp with time zone', nullable: false })
  scheduledFor: Date;

  /** The user's zone at scheduling time, so the time can be shown as they meant it. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  timezone: string | null;

  @Column({ type: 'varchar', length: 20, default: 'scheduled' })
  status: ReminderStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  jobId: string | null;

  /** How many devices Expo actually accepted the push for. 0 is a real outcome. */
  @Column({ type: 'integer', default: 0 })
  deliveredDeviceCount: number;

  @Column({ type: 'timestamp with time zone', nullable: true })
  sentAt: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;
}
