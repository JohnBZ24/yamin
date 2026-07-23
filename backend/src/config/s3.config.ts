import { registerAs } from '@nestjs/config';
import { IsOptional, IsString } from 'class-validator';
import { S3Config } from './s3-config.type';
import validateConfig from './validate-config';

class EnvironmentVariablesValidator {
  @IsString()
  @IsOptional()
  AWS_ACCESS_KEY_ID: string;

  @IsString()
  @IsOptional()
  AWS_SECRET_ACCESS_KEY: string;

  @IsString()
  @IsOptional()
  AWS_S3_REGION: string;

  @IsString()
  @IsOptional()
  AWS_S3_BUCKET: string;

  @IsString()
  @IsOptional()
  AWS_S3_ENDPOINT: string;
}

export default registerAs<S3Config>('s3', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_S3_REGION || 'us-east-1',
    bucket: process.env.AWS_S3_BUCKET,
    endpoint: process.env.AWS_S3_ENDPOINT || undefined,
  };
});
