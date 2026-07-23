import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AllConfigType } from '../config/config.type';
import { AiProviderKind } from '../config/ai-config.type';
import { OpenRouterClient } from './openrouter.client';
import { EMBEDDING_PROVIDER } from './providers/embedding.provider';
import { STT_PROVIDER } from './providers/stt.provider';
import { OpenRouterEmbeddingProvider } from './providers/openrouter-embedding.provider';
import { OpenRouterSttProvider } from './providers/openrouter-stt.provider';
import { MockEmbeddingProvider, MockSttProvider } from './providers/mock.providers';

/**
 * Provider selection happens once, here, at wiring time — driven by the
 * explicit AI_PROVIDER setting.
 *
 * This replaces the previous pattern of re-deriving
 *   `isMock = !apiKey || apiKey.includes('your_openrouter_api_key')`
 * inside three separate methods, which meant a missing or typo'd key in
 * production silently swapped real AI for fabricated output on a per-call basis.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    OpenRouterClient,
    OpenRouterEmbeddingProvider,
    OpenRouterSttProvider,
    MockEmbeddingProvider,
    MockSttProvider,
    {
      provide: EMBEDDING_PROVIDER,
      inject: [ConfigService, OpenRouterEmbeddingProvider, MockEmbeddingProvider],
      useFactory: (
        configService: ConfigService<AllConfigType>,
        real: OpenRouterEmbeddingProvider,
        mock: MockEmbeddingProvider,
      ) =>
        configService.getOrThrow('ai', { infer: true }).provider ===
        AiProviderKind.Mock
          ? mock
          : real,
    },
    {
      provide: STT_PROVIDER,
      inject: [ConfigService, OpenRouterSttProvider, MockSttProvider],
      useFactory: (
        configService: ConfigService<AllConfigType>,
        real: OpenRouterSttProvider,
        mock: MockSttProvider,
      ) =>
        configService.getOrThrow('ai', { infer: true }).provider ===
        AiProviderKind.Mock
          ? mock
          : real,
    },
  ],
  exports: [EMBEDDING_PROVIDER, STT_PROVIDER, OpenRouterClient],
})
export class AiModule {}
