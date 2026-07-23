import { registerAs } from '@nestjs/config';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { RedisConfig } from './redis-config.type';
import validateConfig from './validate-config';

class EnvironmentVariablesValidator {
  @IsString()
  @IsOptional()
  REDIS_HOST: string;

  @IsInt()
  @Min(0)
  @Max(65535)
  @IsOptional()
  REDIS_PORT: number;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD: string;
}

/**
 * Redis was previously read as bare `configService.get('REDIS_HOST')` inside
 * AppModule, bypassing the namespaced+validated config pattern every other
 * setting follows. Now BullMQ, the socket.io adapter and the worker's emitter
 * all resolve the same validated values from one place — they must agree, or
 * jobs and realtime events end up on different servers.
 */
export default registerAs<RedisConfig>('redis', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  };
});
