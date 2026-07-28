import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { REALTIME_NOTIFIER } from '../realtime/realtime.constants';
import type { RealtimeNotifier } from '../realtime/realtime.constants';
import { PushService } from '../realtime/push.service';
import { ReminderRepository } from './infrastructure/reminder.repository';

/**
 * What VoiceProcessor puts on the queue. `reminderId` is optional purely for
 * backwards compatibility: jobs enqueued before the reminder table existed are
 * still sitting in Redis with a delay, and they must deliver rather than crash.
 */
type ReminderJobData = {
  title: string;
  userId: number;
  reminderId?: number;
};

@Processor('reminders-queue')
@Injectable()
export class ReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ReminderProcessor.name);

  constructor(
    @Inject(REALTIME_NOTIFIER) private readonly notifier: RealtimeNotifier,
    private readonly push: PushService,
    private readonly reminders: ReminderRepository,
  ) {
    super();
  }

  async process(job: Job<ReminderJobData, void, string>): Promise<void> {
    const { title, userId, reminderId } = job.data;

    // The title is deliberately not logged — reminder contents are user PII and
    // stdout ships to a log aggregator with long retention.
    this.logger.log(`Reminder job ${job.id} triggered for User ID ${userId}`);

    try {
      // Two paths on purpose, and neither is redundant:
      //  - the socket is the instant in-app path, but only reaches a LIVE
      //    connection, so it does nothing for a closed or backgrounded app;
      //  - push is the one that actually arrives on a phone in someone's pocket.
      // Sent independently so a failure in one still leaves the other delivering.
      await this.notifier.sendToUser(userId, 'reminder-alert', {
        reminderId: reminderId ?? null,
        title,
        timestamp: new Date().toISOString(),
      });

      const delivered = await this.push.sendToUser(
        userId,
        'Yamin reminder',
        title,
      );

      // This is what makes the reminder answerable afterwards. Jobs enqueued
      // before the reminder table existed carry no reminderId — they still
      // deliver, they just have nothing to update.
      if (reminderId) {
        await this.reminders.markSent(reminderId, delivered);
      }

      // Counts only — reminder titles are user PII and stdout ships to a log
      // aggregator with long retention.
      this.logger.log(
        `Reminder job ${job.id}: socket emitted, pushed to ${delivered} device(s)`,
      );
    } catch (error) {
      // Only on the last attempt: marking failed mid-retry would show the user
      // a failure for a reminder BullMQ is still going to deliver.
      const maxAttempts = job.opts.attempts ?? 1;
      if (reminderId && job.attemptsMade + 1 >= maxAttempts) {
        await this.reminders.markFailed(reminderId).catch(() => undefined);
      }
      throw error;
    }
  }
}
