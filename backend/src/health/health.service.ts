import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';

import { AllConfigType } from '../config/config.type';

export type DependencyStatus = 'up' | 'down';

export type HealthReport = {
  status: 'ok' | 'error';
  info: Record<string, { status: DependencyStatus; error?: string }>;
};

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);
  private readonly redis: Redis;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    configService: ConfigService<AllConfigType>,
  ) {
    const redis = configService.getOrThrow('redis', { infer: true });
    this.redis = new Redis({
      host: redis.host,
      port: redis.port,
      password: redis.password,
      maxRetriesPerRequest: 1,
      // Health checks must fail fast rather than queue behind a dead server.
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    this.redis.on('error', (err) =>
      this.logger.warn(`Health Redis client: ${err.message}`),
    );
  }

  /** Liveness: the process is up. Deliberately checks nothing else. */
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness: this instance can actually serve. Checked by orchestrators to
   * decide whether to route traffic here, so it must touch the real
   * dependencies — an instance that cannot reach Postgres or Redis can accept a
   * voice note and then lose it.
   */
  async ready(): Promise<HealthReport> {
    const info: HealthReport['info'] = {};

    info.database = await this.check(() =>
      this.dataSource.query('SELECT 1'),
    );
    info.redis = await this.check(() => this.redis.ping());

    const status = Object.values(info).every((d) => d.status === 'up')
      ? 'ok'
      : 'error';

    return { status, info };
  }

  private async check(
    probe: () => Promise<unknown>,
  ): Promise<{ status: DependencyStatus; error?: string }> {
    try {
      await probe();
      return { status: 'up' };
    } catch (error) {
      return { status: 'down', error: (error as Error).message };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
