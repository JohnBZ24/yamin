import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai';

import { AllConfigType } from '../config/config.type';

/**
 * Single OpenRouter client for every AI call in the app — embeddings, STT, and
 * chat/extraction all route through here via the Vercel AI SDK.
 *
 * OpenRouter is OpenAI-API-compatible, so the `@ai-sdk/openai` provider works
 * against it unchanged by overriding `baseURL`. Verified 2026-07-16 against the
 * live API: `embed()` returns 1536 dims and `transcribe()` returns text.
 */
@Injectable()
export class OpenRouterClient {
  readonly provider: OpenAIProvider;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    const ai = this.configService.getOrThrow('ai', { infer: true });

    this.provider = createOpenAI({
      apiKey: ai.apiKey,
      baseURL: ai.baseUrl,
    });
  }
}
