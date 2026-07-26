import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

type ExpoTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

/**
 * Sends reminders to devices via Expo's push service.
 *
 * This is the delivery path that works when the app is closed. The socket emit
 * only reaches a live connection, so on its own it meant a backgrounded phone
 * missed the reminder entirely and nothing was retried or recorded.
 *
 * Deliberately no SDK dependency: this is one authenticated POST, and the
 * `expo-server-sdk` package would pull in chunking/retry machinery we do not
 * need for a handful of tokens per user.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private static readonly ENDPOINT = 'https://exp.host/--/api/v2/push/send';

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Idempotent per device: re-registering the same token just refreshes it. */
  async registerToken(
    userId: number,
    token: string,
    platform?: string,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO "push_token" ("userId", "token", "platform")
       VALUES ($1, $2, $3)
       ON CONFLICT ("token")
       DO UPDATE SET "userId" = EXCLUDED."userId",
                     "platform" = EXCLUDED."platform",
                     "updatedAt" = now()`,
      [userId, token, platform ?? null],
    );
  }

  async removeToken(token: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM "push_token" WHERE "token" = $1`, [
      token,
    ]);
  }

  /**
   * Returns how many devices were successfully pushed to. Never throws: a
   * reminder must not fail because one stale device token was rejected.
   */
  async sendToUser(
    userId: number,
    title: string,
    body: string,
  ): Promise<number> {
    const rows: Array<{ token: string }> = await this.dataSource.query(
      `SELECT "token" FROM "push_token" WHERE "userId" = $1`,
      [userId],
    );
    if (rows.length === 0) {
      this.logger.warn(`No push tokens registered for user ${userId}`);
      return 0;
    }

    const messages = rows.map((r) => ({
      to: r.token,
      title,
      body,
      sound: 'default',
      // Must match the Android channel created on the client, or Android
      // silently drops the notification.
      channelId: 'reminders',
      priority: 'high',
    }));

    let tickets: ExpoTicket[] = [];
    try {
      const res = await fetch(PushService.ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(messages),
      });
      if (!res.ok) {
        this.logger.error(
          `Expo push HTTP ${res.status}: ${await res.text().catch(() => '')}`,
        );
        return 0;
      }
      const json = (await res.json()) as { data?: ExpoTicket[] };
      tickets = json.data ?? [];
    } catch (error) {
      this.logger.error(
        `Expo push request failed: ${(error as Error).message}`,
      );
      return 0;
    }

    let delivered = 0;
    await Promise.all(
      tickets.map(async (ticket, i) => {
        if (ticket.status === 'ok') {
          delivered += 1;
          return;
        }
        // A token dies when the app is uninstalled. Keeping it means retrying a
        // guaranteed failure on every future reminder, forever.
        if (ticket.details?.error === 'DeviceNotRegistered') {
          this.logger.warn(
            'Dropping a push token Expo reports as unregistered',
          );
          await this.removeToken(rows[i].token).catch(() => undefined);
        } else {
          this.logger.warn(`Expo push rejected a message: ${ticket.message}`);
        }
      }),
    );

    return delivered;
  }
}
