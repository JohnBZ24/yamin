export enum AiProviderKind {
  /** Real calls to the OpenRouter API. */
  OpenRouter = 'openrouter',
  /** Deterministic offline stubs. Never permitted when NODE_ENV=production. */
  Mock = 'mock',
}

export type AiConfig = {
  provider: AiProviderKind;
  apiKey?: string;
  /** Natively 1536-dimensional; matches the `vector(1536)` column exactly. */
  embeddingModel: string;
  embeddingDimensions: number;
  /** `openai/whisper-1`. Note: `openai/whisper` does NOT exist and returns 400. */
  sttModel: string;
  /**
   * ISO-639-1 code pinning the spoken language, or '' to let Whisper detect it.
   *
   * Detection is a guess made from the audio, and on a short or accented clip
   * it guesses wrong — after which Whisper writes the transcript in the
   * language it picked, which comes out looking like an unrequested
   * translation. Pinning removes the guess.
   */
  sttLanguage: string;
  extractionModel: string;
  /**
   * The model for the comprehension-heavy calls: graph extraction, reminder
   * parsing, and answering questions from memories. Kept separate from
   * extractionModel (which still serves quick intent routing and small talk)
   * so those latency-sensitive calls can stay on a fast model while the calls
   * that need to actually understand context run on a stronger one.
   */
  smartModel: string;
  baseUrl: string;
};
