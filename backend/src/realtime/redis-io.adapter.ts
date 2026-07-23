import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ServerOptions } from 'socket.io';

import { RedisConfig } from '../config/redis-config.type';

/**
 * Backs socket.io rooms with Redis so the API can be scaled past one replica
 * and so the worker's emitter can reach sockets it has no local knowledge of.
 *
 * Without this, `server.to(room).emit()` only reaches sockets connected to the
 * current process.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter>;
  private pubClient: Redis;
  private subClient: Redis;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(config: RedisConfig): Promise<void> {
    this.pubClient = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      maxRetriesPerRequest: null,
    });
    this.subClient = this.pubClient.duplicate();

    for (const [name, client] of [
      ['pub', this.pubClient],
      ['sub', this.subClient],
    ] as const) {
      client.on('error', (err) =>
        this.logger.error(`socket.io adapter ${name} client: ${err.message}`),
      );
    }

    await Promise.all([this.pubClient.ping(), this.subClient.ping()]);
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
    this.logger.log('socket.io Redis adapter connected');
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }

  async close(): Promise<void> {
    await Promise.all([this.pubClient?.quit(), this.subClient?.quit()]);
  }
}
