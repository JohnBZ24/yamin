import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

import { AllConfigType } from '../../config/config.type';
import { EmbeddingProvider } from './embedding.provider';
import { SttProvider, TranscribeInput } from './stt.provider';

/**
 * Offline embedding stub. Only reachable via an explicit AI_PROVIDER=mock, and
 * `ai.config.ts` refuses to boot with it when NODE_ENV=production.
 *
 * Deterministic by design: the same text always yields the same vector, derived
 * from a hash of the input. The previous implementation used Math.random(),
 * which made every run produce different vectors for identical input — so
 * nothing downstream of it could be reasoned about or tested.
 *
 * These vectors are meaningless for similarity search. They exist so the
 * pipeline runs offline, not so it returns useful results.
 */
@Injectable()
export class MockEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(MockEmbeddingProvider.name);

  constructor(private readonly configService: ConfigService<AllConfigType>) {}

  async embed(text: string): Promise<number[]> {
    const dimensions = this.configService.getOrThrow('ai', {
      infer: true,
    }).embeddingDimensions;

    this.logger.warn(
      `MOCK embedding for ${text.length} chars — not a real vector.`,
    );

    const seed = createHash('sha256').update(text).digest();
    const vector = new Array<number>(dimensions);

    for (let i = 0; i < dimensions; i++) {
      // Stretch the 32-byte digest across the full vector deterministically.
      const byte = seed[i % seed.length];
      const jitter = seed[(i * 7 + 13) % seed.length];
      vector[i] = (byte / 255) * 2 - 1 + (jitter / 255 - 0.5) * 0.01;
    }

    // Normalise to unit length so cosine distance behaves sanely.
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map((v) => v / magnitude);
  }
}

@Injectable()
export class MockSttProvider implements SttProvider {
  private readonly logger = new Logger(MockSttProvider.name);

  async transcribe({ filename }: TranscribeInput): Promise<string> {
    this.logger.warn(`MOCK transcription for ${filename} — not real audio.`);
    return 'This is a mock transcription of the voice note for local testing.';
  }
}
