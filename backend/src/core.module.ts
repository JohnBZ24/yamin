import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { DataSource, DataSourceOptions } from 'typeorm';

import appConfig from './config/app.config';
import authConfig from './config/auth/auth.config';
import databaseConfig from './database/config/database.config';
import s3Config from './config/s3.config';
import aiConfig from './config/ai.config';
import redisConfig from './config/redis.config';
import { AllConfigType } from './config/config.type';
import { TypeOrmConfigService } from './database/typeorm-config.service';

const infrastructureDatabaseModule = TypeOrmModule.forRootAsync({
  useClass: TypeOrmConfigService,
  dataSourceFactory: async (options: DataSourceOptions) => {
    return new DataSource(options).initialize();
  },
});

/**
 * Everything both process types need: config, database, queue connection.
 *
 * Imported by ApiModule and WorkerModule alike. What must NOT live here is
 * anything that decides whether this process serves HTTP or consumes jobs —
 * that distinction is the entire point of the split.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        databaseConfig,
        authConfig,
        appConfig,
        s3Config,
        aiConfig,
        redisConfig,
      ],
      envFilePath: ['../.env'],
    }),
    infrastructureDatabaseModule,
    EventEmitterModule.forRoot(),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AllConfigType>) => {
        const redis = configService.getOrThrow('redis', { infer: true });
        return {
          connection: {
            host: redis.host,
            port: redis.port,
            password: redis.password,
          },
        };
      },
    }),
  ],
})
export class CoreModule {}
