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
  private readonly storageConfigured: boolean;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    configService: ConfigService<AllConfigType>,
  ) {
    // Config presence, deliberately not a live S3 call: this value gates a
    // deploy-time assertion, and a check that can flake on an AWS blip would
    // eventually be ignored. Missing credentials never flake.
    this.storageConfigured = Boolean(
      configService.get('s3.accessKeyId', { infer: true })?.trim() &&
        configService.get('s3.secretAccessKey', { infer: true })?.trim(),
    );

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

    info.database = await this.check(() => this.dataSource.query('SELECT 1'));
    info.redis = await this.check(() => this.redis.ping());

    // Reported, but deliberately NOT part of the overall status. Without S3 the
    // API still serves typed notes, search and history perfectly well, so
    // pulling the instance out of the load balancer over it would turn a
    // degraded feature into an outage. The deploy asserts on this field
    // directly instead — see .github/workflows/deploy.yml.
    info.storage = this.storageConfigured
      ? { status: 'up' }
      : { status: 'down', error: 'S3 credentials are not configured' };

    const required = [info.database, info.redis];
    const status = required.every((d) => d.status === 'up') ? 'ok' : 'error';

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
