import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { embed } from 'ai';

import { AllConfigType } from '../../config/config.type';
import { OpenRouterClient } from '../openrouter.client';
import { EmbeddingProvider } from './embedding.provider';

@Injectable()
export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly configService: ConfigService<AllConfigType>,
    private readonly client: OpenRouterClient,
  ) {}

  async embed(text: string): Promise<number[]> {
    const ai = this.configService.getOrThrow('ai', { infer: true });

    // No try/catch: a thrown error is retried by BullMQ and is recoverable.
    // Swallowing it and returning a placeholder is not.
    const { embedding } = await embed({
      model: this.client.provider.embedding(ai.embeddingModel),
      value: text,
    });

    // Guard the schema contract. A wrong-length vector fails at the DB anyway,
    // but far from the cause.
    if (embedding.length !== ai.embeddingDimensions) {
      throw new Error(
        `Embedding model ${ai.embeddingModel} returned ${embedding.length} dimensions, ` +
          `expected ${ai.embeddingDimensions}. The vector column and the model disagree.`,
      );
    }

    return embedding;
  }
}
