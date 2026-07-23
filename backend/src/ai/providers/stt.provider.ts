export const STT_PROVIDER = Symbol('STT_PROVIDER');

export type TranscribeInput = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
};

export interface SttProvider {
  /**
   * Returns the transcribed text.
   *
   * Implementations MUST throw on failure rather than returning placeholder
   * text. See the note on {@link EmbeddingProvider.embed}.
   */
  transcribe(input: TranscribeInput): Promise<string>;
}
