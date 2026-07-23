import { NotFoundException } from '@nestjs/common';

import { VoiceService } from './voice.service';
import { VoiceTranscript } from './domain/voice-transcript';

/**
 * The two bugs under test here were security/correctness, not style:
 *
 *  - IDOR: `submitToQueue` looked a note up by `fileUuid` alone, so any
 *    authenticated user who learned a uuid could adopt (and enqueue processing
 *    for) another user's voice note.
 *  - S3 key drift: presign signed `voice-notes/${uuid}${ext}` but submit
 *    rebuilt the key with `.m4a` hardcoded, so any non-m4a upload produced an
 *    `audioUrl` pointing at an object that does not exist.
 */
describe('VoiceService', () => {
  const USER = 7;
  const OTHER_USER = 8;

  let repo: {
    create: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    softDeleteWithMentions: jest.Mock;
  };
  let queue: { add: jest.Mock };
  let service: VoiceService;

  const makeTranscript = (overrides: Partial<VoiceTranscript>): VoiceTranscript =>
    ({
      id: 1,
      fileUuid: 'aaaaaaaa-0000-0000-0000-000000000000',
      audioUrl: null,
      rawText: '',
      status: 'pending',
      summary: null,
      embedding: null,
      userId: USER,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }) as VoiceTranscript;

  beforeEach(() => {
    repo = {
      create: jest.fn(async (data) => makeTranscript(data)),
      findOne: jest.fn(async () => null),
      update: jest.fn(async (id, payload) => makeTranscript({ id, ...payload })),
      softDeleteWithMentions: jest.fn(async () => undefined),
    };
    queue = { add: jest.fn(async () => undefined) };

    // No S3 credentials configured → mock URLs; that path needs no AWS SDK.
    const configService = { get: jest.fn(() => undefined) };
    const sttProvider = { transcribe: jest.fn() };

    service = new VoiceService(
      configService as any,
      repo as any,
      sttProvider as any,
      queue as any,
    );
  });

  describe('generatePresignedUrl', () => {
    it('persists the row at presign time, owned by the requesting user', async () => {
      await service.generatePresignedUrl({ fileExtension: '.wav' }, USER);

      expect(repo.create).toHaveBeenCalledTimes(1);
      const row = repo.create.mock.calls[0][0];
      expect(row.userId).toBe(USER);
      expect(row.status).toBe('awaiting_upload');
      // The real extension, not a hardcoded .m4a — this is the S3-key fix.
      expect(row.audioUrl).toContain(`${row.fileUuid}.wav`);
    });

    it('derives Content-Type from the extension instead of hardcoding audio/mpeg', async () => {
      const wav = await service.generatePresignedUrl({ fileExtension: '.wav' }, USER);
      const m4a = await service.generatePresignedUrl({ fileExtension: '.m4a' }, USER);

      expect(wav.contentType).toBe('audio/wav');
      expect(m4a.contentType).toBe('audio/mp4');
    });
  });

  describe('submitToQueue', () => {
    it("rejects another user's fileUuid as not-found and enqueues nothing", async () => {
      const foreign = makeTranscript({ userId: OTHER_USER });
      repo.findOne
        // scoped lookup {fileUuid, userId} → miss
        .mockResolvedValueOnce(null)
        // unscoped existence check → hit, but it isn't ours
        .mockResolvedValueOnce(foreign);

      await expect(
        service.submitToQueue({ fileUuid: foreign.fileUuid, rawText: 'x' }, USER),
      ).rejects.toThrow(NotFoundException);

      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('creates a typed-note row with a null audioUrl when no presign happened', async () => {
      const result = await service.submitToQueue(
        { fileUuid: 'bbbbbbbb-0000-0000-0000-000000000000', rawText: 'note' },
        USER,
      );

      const row = repo.create.mock.calls[0][0];
      // The old code fabricated an S3 URL for an object that never existed.
      expect(row.audioUrl).toBeNull();
      expect(row.status).toBe('pending');
      expect(row.userId).toBe(USER);
      expect(result.userId).toBe(USER);
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('promotes an awaiting_upload row to pending and attaches the transcript', async () => {
      const presigned = makeTranscript({ status: 'awaiting_upload' });
      repo.findOne.mockResolvedValueOnce(presigned);

      await service.submitToQueue(
        { fileUuid: presigned.fileUuid, rawText: 'spoken words' },
        USER,
      );

      expect(repo.update).toHaveBeenCalledWith(
        presigned.id,
        { rawText: 'spoken words', status: 'pending' },
        undefined,
      );
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('does not knock an already-processed note back to pending on re-submit', async () => {
      const processed = makeTranscript({ status: 'processed' });
      repo.findOne.mockResolvedValueOnce(processed);

      await service.submitToQueue(
        { fileUuid: processed.fileUuid, rawText: 'again' },
        USER,
      );

      expect(repo.update).not.toHaveBeenCalled();
      // Enqueue still happens; jobId = fileUuid makes it idempotent in BullMQ.
      expect(queue.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteNote', () => {
    it('soft-deletes a note the caller owns', async () => {
      const mine = makeTranscript({ id: 42 });
      repo.findOne.mockResolvedValueOnce(mine);

      const result = await service.deleteNote(mine.fileUuid, USER);

      // The lookup must be scoped — same IDOR boundary as submitToQueue.
      expect(repo.findOne.mock.calls[0][0].fields).toEqual({
        fileUuid: mine.fileUuid,
        userId: USER,
      });
      expect(repo.softDeleteWithMentions).toHaveBeenCalledWith(42, undefined);
      expect(result).toEqual({ fileUuid: mine.fileUuid });
    });

    it("treats another user's fileUuid as not-found and deletes nothing", async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.deleteNote('aaaaaaaa-0000-0000-0000-000000000000', OTHER_USER),
      ).rejects.toThrow(NotFoundException);

      expect(repo.softDeleteWithMentions).not.toHaveBeenCalled();
    });
  });
});
