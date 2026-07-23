import { registerAs } from '@nestjs/config';
import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { AiConfig, AiProviderKind } from './ai-config.type';
import validateConfig from './validate-config';

class EnvironmentVariablesValidator {
  @IsEnum(AiProviderKind)
  @IsOptional()
  AI_PROVIDER: AiProviderKind;

  @IsString()
  @IsOptional()
  OPENROUTER_API_KEY: string;

  @IsString()
  @IsOptional()
  AI_EMBEDDING_MODEL: string;

  @IsInt()
  @IsOptional()
  AI_EMBEDDING_DIMENSIONS: number;

  @IsString()
  @IsOptional()
  AI_STT_MODEL: string;

  @IsString()
  @IsOptional()
  AI_STT_LANGUAGE: string;

  @IsString()
  @IsOptional()
  AI_EXTRACTION_MODEL: string;
}

export default registerAs<AiConfig>('ai', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  const provider =
    (process.env.AI_PROVIDER as AiProviderKind) || AiProviderKind.OpenRouter;
  const apiKey = process.env.OPENROUTER_API_KEY;

  // Fail fast at boot rather than degrade to fiction at runtime. A missing key
  // used to silently produce mock summaries and random embeddings that were
  // written to the database as if real, and marked `processed`.
  if (provider === AiProviderKind.OpenRouter && !apiKey) {
    throw new Error(
      'AI_PROVIDER=openrouter requires OPENROUTER_API_KEY. ' +
        'Set the key, or set AI_PROVIDER=mock explicitly for offline development.',
    );
  }

  if (
    provider === AiProviderKind.Mock &&
    process.env.NODE_ENV === 'production'
  ) {
    throw new Error(
      'AI_PROVIDER=mock is not permitted when NODE_ENV=production. ' +
        'Mock providers emit fabricated transcripts and embeddings.',
    );
  }

  return {
    provider,
    apiKey,
    embeddingModel: process.env.AI_EMBEDDING_MODEL || 'text-embedding-3-small',
    embeddingDimensions: process.env.AI_EMBEDDING_DIMENSIONS
      ? parseInt(process.env.AI_EMBEDDING_DIMENSIONS, 10)
      : 1536,
    sttModel: process.env.AI_STT_MODEL || 'google/gemini-2.5-flash',
    // Empty by default, and only consulted on the Whisper path. Pinning one
    // language is wrong for a speaker who mixes Lebanese Arabic, English and
    // French mid-sentence — it just chooses which language gets mangled.
    sttLanguage: (process.env.AI_STT_LANGUAGE ?? '').trim(),
    extractionModel: process.env.AI_EXTRACTION_MODEL || 'google/gemini-2.5-flash',
    baseUrl: 'https://openrouter.ai/api/v1',
  };
});
