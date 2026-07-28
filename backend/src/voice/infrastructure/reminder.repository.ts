import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThanOrEqual, QueryRunner, Repository } from 'typeorm';

import { ReminderEntity } from './reminder.entity';

@Injectable()
export class ReminderRepository {
  constructor(
    @InjectRepository(ReminderEntity)
    private readonly reminders: Repository<ReminderEntity>,
  ) {}

  private repo(queryRunner?: QueryRunner): Repository<ReminderEntity> {
    return queryRunner
      ? queryRunner.manager.getRepository(ReminderEntity)
      : this.reminders;
  }

  /**
   * Records a reminder as scheduled. Called BEFORE the BullMQ job is enqueued,
   * so a reminder that fires always has a row behind it.
   */
  async schedule(
    reminder: Pick<
      ReminderEntity,
      'userId' | 'voiceTranscriptId' | 'title' | 'scheduledFor' | 'timezone'
    >,
    queryRunner?: QueryRunner,
  ): Promise<ReminderEntity> {
    const repository = this.repo(queryRunner);
    return repository.save(
      repository.create({ ...reminder, status: 'scheduled' }),
    );
  }

  async attachJobId(
    id: number,
    jobId: string,
    queryRunner?: QueryRunner,
  ): Promise<void> {
    await this.repo(queryRunner).update(id, { jobId });
  }

  async markSent(
    id: number,
    deliveredDeviceCount: number,
    queryRunner?: QueryRunner,
  ): Promise<void> {
    await this.repo(queryRunner).update(id, {
      status: 'sent',
      deliveredDeviceCount,
      sentAt: new Date(),
    });
  }

  async markFailed(id: number, queryRunner?: QueryRunner): Promise<void> {
    await this.repo(queryRunner).update(id, { status: 'failed' });
  }

  /**
   * What Yamin should know about its own reminders when answering.
   *
   * Deliberately two queries rather than one ORDER BY: the recent past and the
   * near future are different things to the reader, and a single window would
   * either bury an upcoming reminder under old ones or drop the history that
   * makes "what did you remind me about?" answerable. Each side is bounded so a
   * heavy user cannot flood the prompt.
   */
  async listForAiContext(
    { userId, limit = 12 }: { userId: number; limit?: number },
    queryRunner?: QueryRunner,
  ): Promise<{ past: ReminderEntity[]; upcoming: ReminderEntity[] }> {
    const repository = this.repo(queryRunner);
    const now = new Date();

    const [past, upcoming] = await Promise.all([
      repository.find({
        where: { userId, scheduledFor: LessThan(now) },
        order: { scheduledFor: 'DESC' },
        take: limit,
      }),
      repository.find({
        where: { userId, scheduledFor: MoreThanOrEqual(now) },
        order: { scheduledFor: 'ASC' },
        take: limit,
      }),
    ]);

    // Oldest first, so the block reads as a timeline.
    return { past: past.reverse(), upcoming };
  }

  /** The user's reminders for display: soonest upcoming first, then recent history. */
  async listForUser(
    { userId, limit = 20 }: { userId: number; limit?: number },
    queryRunner?: QueryRunner,
  ): Promise<ReminderEntity[]> {
    const { past, upcoming } = await this.listForAiContext(
      { userId, limit },
      queryRunner,
    );
    return [...upcoming, ...past.reverse()].slice(0, limit);
  }
}
