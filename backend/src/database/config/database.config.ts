import { registerAs } from '@nestjs/config';

import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsString,
  ValidateIf,
  IsBoolean,
} from 'class-validator';
// import validateConfig from '../../utils/validate-config';
import { DatabaseConfig } from './database-config.type';
import validateConfig from '../../config/validate-config';

// class EnvironmentTestVariablesValidator {
//   @ValidateIf((envValues) => envValues.TEST_DATABASE_URL)
//   @IsString()
//   TEST_DATABASE_URL: string;

//   @ValidateIf((envValues) => !envValues.TEST_DATABASE_URL)
//   @IsString()
//   TEST_DATABASE_TYPE: string;

//   @ValidateIf((envValues) => !envValues.TEST_DATABASE_URL)
//   @IsString()
//   TEST_DATABASE_HOST: string;

//   @ValidateIf((envValues) => !envValues.TEST_DATABASE_URL)
//   @IsInt()
//   @Min(0)
//   @Max(65535)
//   TEST_DATABASE_PORT: number;

//   @ValidateIf((envValues) => !envValues.TEST_DATABASE_URL)
//   @IsString()
//   TEST_DATABASE_PASSWORD: string;

//   @ValidateIf((envValues) => !envValues.TEST_DATABASE_URL)
//   @IsString()
//   TEST_DATABASE_NAME: string;

//   @ValidateIf((envValues) => !envValues.TEST_DATABASE_URL)
//   @IsString()
//   TEST_DATABASE_USERNAME: string;

//   @IsBoolean()
//   @IsOptional()
//   TEST_DATABASE_SYNCHRONIZE: boolean;

//   @IsInt()
//   @IsOptional()
//   TEST_DATABASE_MAX_CONNECTIONS: number;

//   @IsBoolean()
//   @IsOptional()
//   TEST_DATABASE_SSL_ENABLED: boolean;

//   @IsBoolean()
//   @IsOptional()
//   TEST_DATABASE_REJECT_UNAUTHORIZED: boolean;

//   @IsString()
//   @IsOptional()
//   TEST_DATABASE_CA: string;

//   @IsString()
//   @IsOptional()
//   TEST_DATABASE_KEY: string;

//   @IsString()
//   @IsOptional()
//   TEST_DATABASE_CERT: string;
// }

class EnvironmentVariablesValidator {
  @ValidateIf((envValues) => envValues.DATABASE_URL)
  @IsString()
  DATABASE_URL: string;

  @ValidateIf((envValues) => !envValues.DATABASE_URL)
  @IsString()
  DATABASE_TYPE: string;

  @ValidateIf((envValues) => !envValues.DATABASE_URL)
  @IsString()
  DATABASE_HOST: string;

  @ValidateIf((envValues) => !envValues.DATABASE_URL)
  @IsInt()
  @Min(0)
  @Max(65535)
  DATABASE_PORT: number;

  @ValidateIf((envValues) => !envValues.DATABASE_URL)
  @IsString()
  DATABASE_PASSWORD: string;

  @ValidateIf((envValues) => !envValues.DATABASE_URL)
  @IsString()
  DATABASE_NAME: string;

  @ValidateIf((envValues) => !envValues.DATABASE_URL)
  @IsString()
  DATABASE_USERNAME: string;

  @IsBoolean()
  @IsOptional()
  DATABASE_SYNCHRONIZE: boolean;

  @IsInt()
  @IsOptional()
  DATABASE_MAX_CONNECTIONS: number;

  @IsBoolean()
  @IsOptional()
  DATABASE_SSL_ENABLED: boolean;

  @IsBoolean()
  @IsOptional()
  DATABASE_REJECT_UNAUTHORIZED: boolean;

  @IsString()
  @IsOptional()
  DATABASE_CA: string;

  @IsString()
  @IsOptional()
  DATABASE_KEY: string;

  @IsString()
  @IsOptional()
  DATABASE_CERT: string;
}

export default registerAs<DatabaseConfig>('database', () => {
  {
    validateConfig(process.env, EnvironmentVariablesValidator);

    return {
      isDocumentDatabase: ['mongodb'].includes(process.env.DATABASE_TYPE ?? ''),
      url: process.env.DATABASE_URL,
      type: process.env.DATABASE_TYPE,
      host: process.env.DATABASE_HOST,
      port: process.env.DATABASE_PORT
        ? parseInt(process.env.DATABASE_PORT, 10)
        : 5432,
      password: process.env.DATABASE_PASSWORD,
      name: process.env.DATABASE_NAME,
      username: process.env.DATABASE_USERNAME,
      synchronize: process.env.DATABASE_SYNCHRONIZE === 'true',
      maxConnections: process.env.DATABASE_MAX_CONNECTIONS
        ? parseInt(process.env.DATABASE_MAX_CONNECTIONS, 10)
        : 100,
      sslEnabled: process.env.DATABASE_SSL_ENABLED === 'true',
      rejectUnauthorized: process.env.DATABASE_REJECT_UNAUTHORIZED === 'true',
      ca: process.env.DATABASE_CA,
      key: process.env.DATABASE_KEY,
      cert: process.env.DATABASE_CERT,
    };
  }

  // if (process.env.NODE_ENV == 'test') {
  //   validateConfig(process.env, EnvironmentTestVariablesValidator);

  //   return {
  //     isDocumentDatabase: ['mongodb'].includes(
  //       process.env.TEST_DATABASE_TYPE ?? '',
  //     ),
  //     url: process.env.TEST_DATABASE_URL,
  //     type: process.env.TEST_DATABASE_TYPE,
  //     host: process.env.TEST_DATABASE_HOST,
  //     port: process.env.TEST_DATABASE_PORT
  //       ? parseInt(process.env.TEST_DATABASE_PORT, 10)
  //       : 5432,
  //     password: process.env.TEST_DATABASE_PASSWORD,
  //     name: process.env.TEST_DATABASE_NAME,
  //     username: process.env.TEST_DATABASE_USERNAME,
  //     synchronize: process.env.TEST_DATABASE_SYNCHRONIZE === 'true',
  //     maxConnections: process.env.TEST_DATABASE_MAX_CONNECTIONS
  //       ? parseInt(process.env.TEST_DATABASE_MAX_CONNECTIONS, 10)
  //       : 100,
  //     sslEnabled: process.env.TEST_DATABASE_SSL_ENABLED === 'true',
  //     rejectUnauthorized:
  //       process.env.TEST_DATABASE_REJECT_UNAUTHORIZED === 'true',
  //     ca: process.env.TEST_DATABASE_CA,
  //     key: process.env.TEST_DATABASE_KEY,
  //     cert: process.env.TEST_DATABASE_CERT,
  //   };
  // }
});
