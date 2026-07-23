import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Emitter } from '@socket.io/redis-emitter';
import Redis from 'ioredis';

import { AllConfigType } from '../config/config.type';
import { RealtimeNotifier, userRoom } from './realtime.constants';

/**
 * Emits socket.io events from a process that has no socket.io server.
 *
 * The worker has no HTTP listener and therefore no connected sockets. Rather
 * than inventing a bespoke pub/sub hop and re-emitting on the API side (which
 * would double-deliver once the API runs more than one replica, since every
 * replica would receive the message and re-broadcast it), this speaks the
 * adapter's own wire protocol. The message is published once and the adapter
 * delivers it exactly once to whichever API instance holds that user's socket.
 *
 * The emitter's key prefix must match the adapter's on the API side. Both use
 * the socket.io default of `socket.io`; if one is ever customised, so must the
 * other, or events vanish silently.
 */
@Injectable()
export class RedisEmitterNotifier implements RealtimeNotifier, OnModuleDestroy {
  private readonly logger = new Logger(RedisEmitterNotifier.name);
  private readonly client: Redis;
  private readonly emitter: Emitter;

  constructor(configService: ConfigService<AllConfigType>) {
    const redis = configService.getOrThrow('redis', { infer: true });

    this.client = new Redis({
      host: redis.host,
      port: redis.port,
      password: redis.password,
      maxRetriesPerRequest: null,
    });
    this.client.on('error', (err) =>
      this.logger.error(`Realtime emitter Redis error: ${err.message}`),
    );

    this.emitter = new Emitter(this.client);
  }

  async sendToUser(
    userId: number,
    event: string,
    payload: unknown,
  ): Promise<void> {
    // Payload contents are deliberately not logged — summaries and reminder
    // titles are user PII and stdout ships to a log aggregator.
    this.emitter.to(userRoom(userId)).emit(event, payload);
    this.logger.log(`Emitted '${event}' to user ${userId}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
