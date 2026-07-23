export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

export interface EmbeddingProvider {
  /**
   * Returns a vector of exactly `ai.embeddingDimensions` floats.
   *
   * Implementations MUST throw on failure rather than returning a placeholder.
   * A thrown error is retried by BullMQ and is recoverable; a fabricated vector
   * is written to the database, marked `processed`, and is indistinguishable
   * from real data forever.
   */
  embed(text: string): Promise<number[]>;
}
