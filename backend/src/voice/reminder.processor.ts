import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { REALTIME_NOTIFIER } from '../realtime/realtime.constants';
import type { RealtimeNotifier } from '../realtime/realtime.constants';
import { PushService } from '../realtime/push.service';

@Processor('reminders-queue')
@Injectable()
export class ReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ReminderProcessor.name);

  constructor(
    @Inject(REALTIME_NOTIFIER) private readonly notifier: RealtimeNotifier,
    private readonly push: PushService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { title, userId } = job.data;

    // The title is deliberately not logged — reminder contents are user PII and
    // stdout ships to a log aggregator with long retention.
    this.logger.log(`Reminder job ${job.id} triggered for User ID ${userId}`);

    // Two paths on purpose, and neither is redundant:
    //  - the socket is the instant in-app path, but only reaches a LIVE
    //    connection, so it does nothing for a closed or backgrounded app;
    //  - push is the one that actually arrives on a phone in someone's pocket.
    // Sent independently so a failure in one still leaves the other delivering.
    await this.notifier.sendToUser(userId, 'reminder-alert', {
      title,
      timestamp: new Date().toISOString(),
    });

    const delivered = await this.push.sendToUser(userId, 'Yamin reminder', title);

    // Counts only — reminder titles are user PII and stdout ships to a log
    // aggregator with long retention.
    this.logger.log(
      `Reminder job ${job.id}: socket emitted, pushed to ${delivered} device(s)`,
    );
  }
}
