import { registerAs } from '@nestjs/config';
import { AppConfig } from './app-config.type';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';
import validateConfig from './validate-config';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariablesValidator {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment;

  @IsInt()
  @Min(0)
  @Max(65535)
  @IsOptional()
  APP_PORT: number;

  @IsUrl({ require_tld: false })
  @IsOptional()
  FRONTEND_DOMAIN: string;

  @IsUrl({ require_tld: false })
  @IsOptional()
  ADMIN_DOMAIN: string;

  @IsUrl({ require_tld: false })
  @IsOptional()
  BACKEND_DOMAIN: string;

  @IsString()
  @IsOptional()
  API_PREFIX: string;

  @IsString()
  @IsOptional()
  APP_FALLBACK_LANGUAGE: string;

  @IsString()
  @IsOptional()
  APP_HEADER_LANGUAGE: string;

  @IsString()
  @IsOptional()
  DEFAULT_TIMEZONE: string;
}

export default registerAs<AppConfig>('app', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  if (process.env.NODE_ENV == 'test') {
    return {
      nodeEnv: process.env.NODE_ENV,
      name: process.env.APP_NAME || 'app',
      workingDirectory: process.env.PWD || process.cwd(),
      adminDomain: process.env.ADMIN_DOMAIN,
      frontendDomain: process.env.FRONTEND_DOMAIN,
      backendDomain: process.env.TEST_BACKEND_DOMAIN ?? 'http://localhost',
      port: process.env.TEST_APP_PORT
        ? parseInt(process.env.TEST_APP_PORT, 10)
        : process.env.TEST_PORT
          ? parseInt(process.env.TEST_PORT, 10)
          : 3000,
      apiPrefix: process.env.API_PREFIX || 'api',
      fallbackLanguage: process.env.APP_FALLBACK_LANGUAGE || 'en',
      headerLanguage: process.env.APP_HEADER_LANGUAGE || 'x-custom-lang',
      defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Asia/Beirut',
    };
  } else {
    return {
      nodeEnv: process.env.NODE_ENV || 'development',
      name: process.env.APP_NAME || 'app',
      workingDirectory: process.env.PWD || process.cwd(),
      adminDomain: process.env.ADMIN_DOMAIN,
      frontendDomain: process.env.FRONTEND_DOMAIN,
      backendDomain: process.env.BACKEND_DOMAIN ?? 'http://localhost',
      port: process.env.APP_PORT
        ? parseInt(process.env.APP_PORT, 10)
        : process.env.PORT
          ? parseInt(process.env.PORT, 10)
          : 3000,
      apiPrefix: process.env.API_PREFIX || 'api',
      fallbackLanguage: process.env.APP_FALLBACK_LANGUAGE || 'en',
      headerLanguage: process.env.APP_HEADER_LANGUAGE || 'x-custom-lang',
      defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Asia/Beirut',
    };
  }
});
