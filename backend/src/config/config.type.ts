import { AppConfig } from './app-config.type';
import { AuthConfig } from './auth/auth-config.type';
import { DatabaseConfig } from '../database/config/database-config.type';
import { S3Config } from './s3-config.type';
import { AiConfig } from './ai-config.type';
import { RedisConfig } from './redis-config.type';

export type AllConfigType = {
  app: AppConfig;
  auth: AuthConfig;
  database: DatabaseConfig;
  s3: S3Config;
  ai: AiConfig;
  redis: RedisConfig;
};
