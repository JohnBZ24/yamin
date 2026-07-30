import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { QueryRunner } from 'typeorm';

import { AllConfigType } from '../config/config.type';
import { CreateVoiceProcessingDto } from './dto/create-voice-processing.dto';
import { RequestPresignedUrlDto } from './dto/request-presigned-url.dto';
import { VoiceTranscriptRepository } from './infrastructure/voice-transcript.repository';
import { VoiceTranscript } from './domain/voice-transcript';
import { STT_PROVIDER } from '../ai/providers/stt.provider';
import type { SttProvider } from '../ai/providers/stt.provider';
import { onAfterCommit } from '../utils/queryRunner/after-commit';

/**
 * A note as the client sees it: everything except the embedding, plus a boolean
 * saying whether there was one.
 */
export type VoiceNoteView = Omit<VoiceTranscript, 'embedding'> & {
  remembered: boolean;
};

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  private s3Client: S3Client | null = null;
  private readonly s3Endpoint: string | undefined;
  private readonly isProduction: boolean;

  /** True once S3 credentials are present, so the storage check can say so. */
  get storageConfigured(): boolean {
    return this.s3Client !== null;
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly voiceRepository: VoiceTranscriptRepository,
    @Inject(STT_PROVIDER) private readonly sttProvider: SttProvider,
    @InjectQueue('voice-processing') private readonly voiceQueue: Queue,
  ) {
    this.isProduction =
      this.configService.get<string>('app.nodeEnv') === 'production';

    // Trimmed, and empty-checked rather than truthy-checked on the raw value:
    // `AWS_ACCESS_KEY_ID=` in a .env yields '', which is falsy — but
    // `AWS_ACCESS_KEY_ID=" "` yields ' ', which is not, and would build a
    // client that 403s on every call instead of failing the check here.
    const accessKeyId = this.configService
      .get<string>('s3.accessKeyId')
      ?.trim();
    const secretAccessKey = this.configService
      .get<string>('s3.secretAccessKey')
      ?.trim();
    const region = this.configService.get<string>('s3.region') || 'us-east-1';

    // Normalized once, used everywhere. A .env line like
    //   AWS_S3_ENDPOINT= # some comment
    // reaches us as the literal comment text (env parsers disagree on inline
    // comments), and handing that to the AWS SDK made every presign call throw
    // ERR_INVALID_URL at request time. Anything that isn't an http(s) URL is
    // treated as unset, loudly.
    const rawEndpoint = this.configService.get<string>('s3.endpoint');
    this.s3Endpoint = rawEndpoint?.startsWith('http') ? rawEndpoint : undefined;
    if (rawEndpoint && !this.s3Endpoint) {
      this.logger.warn(
        `Ignoring S3 endpoint that is not a URL: "${rawEndpoint}" — check .env for an inline comment on the AWS_S3_ENDPOINT line.`,
      );
    }
    const endpoint = this.s3Endpoint;

    if (accessKeyId && secretAccessKey) {
      this.s3Client = new S3Client({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        endpoint: endpoint || undefined,
        forcePathStyle: !!endpoint,
        // SDK >=3.729 defaults to WHEN_SUPPORTED, which bakes an
        // x-amz-checksum-crc32 of the EMPTY body into presigned PUT URLs —
        // S3 then rejects any real upload with a checksum mismatch.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    } else if (this.isProduction) {
      // Loud, because this is exactly the failure that shipped once: the server
      // had no AWS keys, generatePresignedUrl quietly returned
      // `http://localhost:3000/mock-upload/...`, and every phone dutifully PUT
      // its recording at itself. The device-side symptom ("storage problem")
      // pointed nowhere near the actual cause, which was one missing .env line.
      this.logger.error(
        'AWS S3 credentials are missing in production — voice notes cannot store audio. ' +
          'Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in the server .env and restart. ' +
          'Presign requests will now fail with 503 instead of returning unusable mock URLs.',
      );
    } else {
      this.logger.warn(
        'AWS S3 credentials not configured — presigned URLs fall back to local mock URLs. ' +
          'This is fine for development; it would be a broken voice feature in production.',
      );
    }
  }

  /**
   * Derived from the extension, and returned to the client so it can echo it on
   * the PUT rather than guess. It used to be hardcoded 'audio/mpeg' regardless
   * of the real container.
   *
   * Not a signature constraint, despite how it looks: `getSignedUrl` puts only
   * `host` in X-Amz-SignedHeaders, so S3 does not verify Content-Type and will
   * accept a PUT that sends the wrong one (measured, not assumed). What it does
   * decide is the Content-Type the object is STORED with — and the app plays
   * notes back straight from that URL, so getting it wrong breaks playback on
   * an upload that otherwise looks completely successful.
   */
  private contentTypeFor(extension: string): string {
    const types: Record<string, string> = {
      '.m4a': 'audio/mp4',
      '.mp4': 'audio/mp4',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.webm': 'audio/webm',
      '.ogg': 'audio/ogg',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac',
    };
    return types[extension.toLowerCase()] ?? 'application/octet-stream';
  }

  async generatePresignedUrl(
    dto: RequestPresignedUrlDto,
    userId: number,
  ): Promise<{
    fileUuid: string;
    uploadUrl: string;
    downloadUrl: string;
    contentType: string;
  }> {
    const fileUuid = randomUUID();
    const rawExtension = dto.fileExtension || '.m4a';
    const extension = rawExtension.startsWith('.')
      ? rawExtension
      : `.${rawExtension}`;
    const key = `voice-notes/${fileUuid}${extension}`;
    const contentType = this.contentTypeFor(extension);
    const bucket =
      this.configService.get<string>('s3.bucket') || 'yamin-voice-notes';

    let uploadUrl = '';
    let downloadUrl = '';

    // A mock URL is a development convenience that becomes a trap the moment it
    // leaves this machine: `localhost` on a phone is the phone, so the upload
    // fails with a network error that looks like anything but a server
    // misconfiguration. Better to say plainly that storage is unavailable —
    // the client can then keep the transcript and drop only the audio.
    if (!this.s3Client && this.isProduction) {
      throw new ServiceUnavailableException(
        'Audio storage is not configured on the server',
      );
    }

    if (this.s3Client) {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      });
      uploadUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: 3600,
      });

      const region = this.configService.get<string>('s3.region') || 'us-east-1';
      const endpoint = this.s3Endpoint;
      downloadUrl = endpoint
        ? `${endpoint}/${bucket}/${key}`
        : `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    } else {
      // Mock URLs for local development
      uploadUrl = `http://localhost:3000/mock-upload/${key}`;
      downloadUrl = `http://localhost:3000/mock-download/${key}`;
    }

    // Persist the row NOW, owned by the requesting user, with the real key.
    // This closes two bugs at once:
    //  - IDOR: submitToQueue used to look up by fileUuid alone, so anyone who
    //    learned a uuid could adopt another user's note. The row is now born
    //    with a userId and submit loads it scoped to the caller.
    //  - Wrong key: submit used to REBUILD the key as `.m4a`/'audio/mpeg'
    //    hardcoded, so a `.wav` upload produced an audioUrl pointing at an
    //    object that doesn't exist. The URL is now written once, here, and
    //    never recomputed.
    await this.voiceRepository.create({
      fileUuid,
      audioUrl: downloadUrl,
      rawText: '',
      status: 'awaiting_upload',
      summary: null,
      // Arrives with the submit — the recording is still in progress here.
      peaks: null,
      embedding: null,
      userId,
    });

    // The DB keeps the canonical URL; the client gets a playable presigned GET.
    return {
      fileUuid,
      uploadUrl,
      downloadUrl: (await this.signAudioUrl(downloadUrl)) ?? downloadUrl,
      contentType,
    };
  }

  /**
   * NOTE: this endpoint is scheduled for removal in Phase 2 — transcription
   * moves into the worker and reads from S3, so the client stops uploading the
   * file twice and stops supplying unverifiable `rawText`. Kept working here so
   * the current frontend flow doesn't break in the meantime.
   */
  async transcribeAudio(file?: Express.Multer.File): Promise<{ text: string }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No audio file received');
    }

    try {
      const text = await this.sttProvider.transcribe({
        buffer: file.buffer,
        filename: file.originalname || 'audio.m4a',
        mimeType: file.mimetype || 'audio/mp4',
      });
      return { text };
    } catch (error) {
      // A 4xx from the STT provider means the audio itself was unusable — a
      // quick-tap recording is a container header with no frames, and the
      // provider rejects it ("Provider returned 400"). That is the client's
      // recording to redo, not a server fault, so it must not surface as 500.
      const status = (error as { statusCode?: number })?.statusCode;
      if (typeof status === 'number' && status >= 400 && status < 500) {
        this.logger.warn(
          `STT rejected audio (${status}): ${(error as Error).message}`,
        );
        throw new UnprocessableEntityException(
          "Couldn't make out any speech in that recording — try again",
        );
      }
      throw error;
    }
  }

  async submitToQueue(
    dto: CreateVoiceProcessingDto,
    userId: number,
    queryRunner?: QueryRunner,
  ): Promise<VoiceTranscript> {
    // Scoped to the caller — this is the IDOR fix. A uuid belonging to another
    // user must behave exactly like a uuid that doesn't exist (404), never be
    // adoptable or even confirmed to exist.
    let transcript = await this.voiceRepository.findOne({
      fields: { fileUuid: dto.fileUuid, userId } as any,
      queryRunner,
    });

    if (!transcript) {
      const foreign = await this.voiceRepository.findOne({
        fields: { fileUuid: dto.fileUuid } as any,
        queryRunner,
      });
      if (foreign) {
        throw new NotFoundException('Voice note not found');
      }

      // No presign happened for this uuid, so there is no audio object — this
      // is the typed-note path, where the client mints the uuid itself.
      // audioUrl stays null instead of the old fabricated S3 URL that pointed
      // at an object which never existed.
      transcript = await this.voiceRepository.create(
        {
          fileUuid: dto.fileUuid,
          audioUrl: null,
          rawText: dto.rawText || '',
          status: 'pending',
          summary: null,
          // Typed notes have no audio, so no envelope to draw.
          peaks: dto.peaks ?? null,
          embedding: null,
          userId,
        },
        queryRunner,
      );
    } else if (transcript.status === 'awaiting_upload') {
      // Row was created at presign time; attach the transcript and make it
      // eligible for processing. Rows in any other status are left untouched so
      // an idempotent re-submit can't knock a 'processed' note back to
      // 'pending'.
      transcript =
        (await this.voiceRepository.update(
          transcript.id,
          {
            rawText: dto.rawText || '',
            status: 'pending',
            // Spread so a submit without peaks leaves an existing envelope
            // alone rather than nulling it.
            ...(dto.peaks ? { peaks: dto.peaks } : {}),
          },
          queryRunner,
        )) ?? transcript;
    }

    // Enqueue only once the transaction commits. Redis does not participate in
    // the Postgres transaction, so adding the job here-and-now let the worker
    // dequeue and look up the transcript before the INSERT was visible —
    // "Voice transcript record not found" — or, on rollback, left a job
    // pointing at a row that never existed.
    await onAfterCommit(queryRunner, () => this.enqueueVoiceJob(dto, userId));

    return transcript;
  }

  private async enqueueVoiceJob(
    dto: CreateVoiceProcessingDto,
    userId: number,
  ): Promise<void> {
    await this.voiceQueue.add(
      'process-voice-job',
      {
        fileUuid: dto.fileUuid,
        rawText: dto.rawText || '',
        userId,
        timezone: dto.timezone,
      },
      {
        // Idempotent on double-submit.
        jobId: dto.fileUuid,
        // Without attempts, the default of 1 means a single OpenRouter 429
        // permanently loses the user's voice note.
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        // BullMQ retains completed/failed job ids and silently no-ops add() for
        // them, so without removeOnComplete a failed uuid could never be
        // re-submitted. Also stops Redis growing without bound.
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 86_400 },
      },
    );
  }

  /**
   * "I said something wrong — get rid of it." Scoped to the caller exactly like
   * submitToQueue: a foreign uuid must behave like a missing one.
   *
   * Soft delete, not hard: the history query, semantic search, and mention
   * provenance all already filter deletedAt, so the note vanishes everywhere at
   * once while staying recoverable in the database. The S3 object is removed
   * after commit — if the row delete rolls back, the audio must not be gone.
   */
  async deleteNote(
    fileUuid: string,
    userId: number,
    queryRunner?: QueryRunner,
  ): Promise<{ fileUuid: string }> {
    const transcript = await this.voiceRepository.findOne({
      fields: { fileUuid, userId } as any,
      queryRunner,
    });
    if (!transcript) {
      throw new NotFoundException('Voice note not found');
    }

    await this.voiceRepository.softDeleteWithMentions(
      transcript.id,
      queryRunner,
    );

    await onAfterCommit(queryRunner, () =>
      this.deleteAudioObject(transcript.audioUrl),
    );

    return { fileUuid };
  }

  /**
   * Best-effort: the note is already gone for the user once the row is
   * soft-deleted; a stranded S3 object (e.g. the IAM user lacking
   * s3:DeleteObject) is a cost problem, not a correctness one, so it logs
   * instead of failing the request.
   */
  private keyFromUrl(audioUrl: string): string | null {
    const bucket =
      this.configService.get<string>('s3.bucket') || 'yamin-voice-notes';
    try {
      const path = decodeURIComponent(new URL(audioUrl).pathname).replace(
        /^\//,
        '',
      );
      // Path-style URLs (custom endpoint) carry the bucket as the first segment.
      return path.startsWith(`${bucket}/`)
        ? path.slice(bucket.length + 1)
        : path;
    } catch {
      return null;
    }
  }

  /**
   * The bucket is private (public GET is 403), so the canonical URL stored in
   * the database is not directly playable in a browser. Rows keep the stable
   * canonical URL; anything returned to a client gets swapped for a presigned
   * GET here.
   */
  private async signAudioUrl(audioUrl: string | null): Promise<string | null> {
    if (!audioUrl || !this.s3Client) return audioUrl;
    const key = this.keyFromUrl(audioUrl);
    if (!key) return audioUrl;

    const bucket =
      this.configService.get<string>('s3.bucket') || 'yamin-voice-notes';
    try {
      return await getSignedUrl(
        this.s3Client,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: 86_400 },
      );
    } catch (error) {
      this.logger.warn(
        `Could not presign audio URL for ${key}: ${(error as Error).message}`,
      );
      return audioUrl;
    }
  }

  private async deleteAudioObject(audioUrl: string | null): Promise<void> {
    if (!audioUrl || !this.s3Client) return;

    const bucket =
      this.configService.get<string>('s3.bucket') || 'yamin-voice-notes';
    const key = this.keyFromUrl(audioUrl);
    if (!key) {
      this.logger.warn(`Could not parse audio URL for deletion: ${audioUrl}`);
      return;
    }

    try {
      await this.s3Client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key }),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to delete S3 object ${key}: ${(error as Error).message}`,
      );
    }
  }

  async getUserHistory(
    userId: number,
    page: number,
    limit: number,
    queryRunner?: QueryRunner,
  ): Promise<{ data: VoiceNoteView[]; totalCount: number }> {
    const result = await this.voiceRepository.findManyWithPagination({
      userId,
      paginationOptions: { page, limit },
      queryRunner,
    });

    const data = await Promise.all(
      // `embedding` is destructured off rather than spread through, and that is
      // not cosmetic: it is a 1536-float vector per note, so a page of twenty was
      // sending roughly half a megabyte of numbers to a phone that has no use for
      // any of them. Its PRESENCE is the only part the client needs, and that is
      // one boolean.
      result.data.map(async ({ embedding, ...note }) => ({
        ...note,
        audioUrl: await this.signAudioUrl(note.audioUrl),
        /**
         * Whether this note is actually in the memory.
         *
         * `status: 'processed'` does not mean remembered. The extractor decides
         * whether a note has anything about the user's life in it, and a note
         * judged not memorable is written WITHOUT an embedding — so semantic
         * search can never return it. The client showed a green "Remembered"
         * badge on those all the same, which claims the opposite of what
         * happened.
         *
         * Derived from the embedding rather than stored separately so it cannot
         * drift from the thing it describes: no embedding, not retrievable, not
         * remembered.
         */
        remembered: embedding != null,
      })),
    );

    return { data, totalCount: result.totalCount };
  }
}
