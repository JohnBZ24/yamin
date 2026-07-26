import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AllConfigType } from '../../config/config.type';
import { SttProvider, TranscribeInput } from './stt.provider';

/** Non-2xx from the STT endpoint; statusCode lets callers tell "bad audio" (4xx) from "provider down" (5xx). */
export class SttProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

/**
 * What the speaker actually sounds like in Lebanon, spelled out for the model.
 *
 * Whisper cannot be told any of this — it takes audio and an optional language
 * code, and one code cannot describe a sentence like "hi kifak, ça va?". A
 * multimodal model can be instructed, which is the whole reason this path
 * exists alongside the Whisper one.
 */
const LEBANESE_TRANSCRIPTION_PROMPT = [
  'Transcribe this voice note exactly as spoken.',
  '',
  'The speaker is Lebanese. They may speak Lebanese Arabic (spoken Levantine,',
  'not Modern Standard), English, or French — and they routinely switch between',
  'all three inside a single sentence.',
  '',
  'Rules:',
  '- Transcribe verbatim, in whatever language each word was actually spoken.',
  '- NEVER translate. If a sentence mixes languages, keep the mix exactly.',
  '- Write Arabic in Arabic script, English and French in Latin script.',
  '- Write spoken Lebanese as it is said, not corrected into Modern Standard Arabic.',
  '- Keep names of people and places as pronounced.',
  '- Output ONLY the transcript. No translation, no notes, no quotes, no preamble.',
  '- If there is no intelligible speech, output nothing at all.',
].join('\n');

/** OpenRouter wants a bare container name for `input_audio.format`. */
const FORMAT_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
};

@Injectable()
export class OpenRouterSttProvider implements SttProvider {
  private readonly logger = new Logger(OpenRouterSttProvider.name);

  constructor(private readonly configService: ConfigService<AllConfigType>) {}

  async transcribe(input: TranscribeInput): Promise<string> {
    const ai = this.configService.getOrThrow('ai', { infer: true });

    // Whisper only speaks the /audio/transcriptions protocol; everything else
    // here is a chat model that takes audio as a message part.
    return /whisper/i.test(ai.sttModel)
      ? this.viaWhisper(input, ai)
      : this.viaMultimodalChat(input, ai);
  }

  /**
   * `openai/whisper-1`, not `openai/whisper` — the latter is not a real slug
   * and returns 400 "Model openai/whisper does not exist" on every call.
   *
   * Sends filename and MIME type as given rather than re-sniffing them: the
   * Vercel AI SDK's detector expects `ftyp` at byte 0, where real .m4a files
   * carry it at byte 4, so every native recording went up mislabelled as wav.
   */
  private async viaWhisper(
    { buffer, filename, mimeType }: TranscribeInput,
    ai: {
      sttModel: string;
      sttLanguage: string;
      baseUrl: string;
      apiKey?: string;
    },
  ): Promise<string> {
    const form = new FormData();
    form.append('model', ai.sttModel);
    form.append(
      'file',
      new File([new Uint8Array(buffer)], filename, { type: mimeType }),
    );
    // Only when explicitly pinned. Left unset, Whisper detects the language and
    // then writes the transcript in whatever it detected — which is how an
    // English clip came back in Arabic. Pinning is not a fix for a multilingual
    // speaker though; it just moves which language gets mangled.
    if (ai.sttLanguage) {
      form.append('language', ai.sttLanguage);
    }

    const res = await fetch(`${ai.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ai.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      throw await this.errorFor(res);
    }

    const json = (await res.json()) as { text?: string };
    return json.text ?? '';
  }

  /**
   * A multimodal chat model doing the transcription, so the instructions above
   * apply. Handles Lebanese Arabic and mid-sentence code-switching, which a
   * single Whisper language code cannot express.
   */
  private async viaMultimodalChat(
    { buffer, mimeType }: TranscribeInput,
    ai: { sttModel: string; baseUrl: string; apiKey?: string },
  ): Promise<string> {
    const format = FORMAT_BY_MIME[mimeType.split(';')[0].trim().toLowerCase()];
    if (!format) {
      this.logger.warn(
        `Unmapped audio MIME type "${mimeType}", sending as wav`,
      );
    }

    const res = await fetch(`${ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ai.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ai.sttModel,
        // Transcription, not creative writing: keep it faithful to the audio.
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: LEBANESE_TRANSCRIPTION_PROMPT },
              {
                type: 'input_audio',
                input_audio: {
                  data: buffer.toString('base64'),
                  format: format ?? 'wav',
                },
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      throw await this.errorFor(res);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content ?? '';

    // Models like to narrate silence ("[no speech detected]") rather than
    // return nothing. Callers treat empty as "I couldn't hear that", so
    // normalise those to empty instead of storing them as a memory.
    const cleaned = text.trim();
    if (/^[[(<]?\s*(no|inaudible|silence|empty)\b/i.test(cleaned)) {
      return '';
    }
    return cleaned;
  }

  private async errorFor(res: Response): Promise<SttProviderError> {
    const body = await res.text().catch(() => '');
    let message = `Transcription failed (${res.status})`;
    try {
      message = JSON.parse(body)?.error?.message ?? message;
    } catch {
      // non-JSON error body; keep the generic message
    }
    return new SttProviderError(message, res.status);
  }
}
