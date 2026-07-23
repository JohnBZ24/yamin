import { ConfigService } from '@nestjs/config';

import { MockEmbeddingProvider } from './mock.providers';

const configWith = (embeddingDimensions: number) =>
  ({
    getOrThrow: () => ({ embeddingDimensions }),
    get: () => ({ embeddingDimensions }),
  }) as unknown as ConfigService;

/**
 * The mock replaced a `Math.random()` fallback that was writing junk vectors to
 * the database and marking them `processed`. Determinism is the property that
 * makes it safe: the same text must always give the same vector, or tests and
 * local development are quietly non-reproducible.
 */
describe('MockEmbeddingProvider', () => {
  const provider = new MockEmbeddingProvider(configWith(1536));

  it('returns the configured dimensionality', async () => {
    const vector = await provider.embed('hello');
    expect(vector).toHaveLength(1536);
  });

  it('is deterministic for the same input', async () => {
    const a = await provider.embed('Met Sarah about pricing');
    const b = await provider.embed('Met Sarah about pricing');
    expect(a).toEqual(b);
  });

  it('gives different vectors for different input', async () => {
    const a = await provider.embed('Met Sarah about pricing');
    const b = await provider.embed('Lunch with Tom on Friday');
    expect(a).not.toEqual(b);
  });

  it('returns a unit vector, like the real provider does', async () => {
    const vector = await provider.embed('anything');
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('produces only finite numbers', async () => {
    // A NaN would poison pgvector and fail the insert in a very confusing way.
    const vector = await provider.embed('edge case');
    expect(vector.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('handles empty and unicode input without throwing', async () => {
    await expect(provider.embed('')).resolves.toHaveLength(1536);
    await expect(provider.embed('يامين 北京 🎙️')).resolves.toHaveLength(1536);
  });

  it('honours a different configured dimensionality', async () => {
    const small = new MockEmbeddingProvider(configWith(256));
    await expect(small.embed('hi')).resolves.toHaveLength(256);
  });
});
