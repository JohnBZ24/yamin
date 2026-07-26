import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryRunner } from 'typeorm';

import { MemoryService } from './memory.service';
import { MemoryRepository } from './infrastructure/memory.repository';

const generateTextMock = jest.fn();
const generateObjectMock = jest.fn();
jest.mock('ai', () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
  streamText: jest.fn(),
}));

// `@ai-sdk/openai` is ESM-only and reaches this suite transitively through
// OpenRouterClient, which ts-jest (CJS) cannot parse. The real client is never
// used here — a fake is injected below — so stubbing the module is enough and
// avoids inflicting an ESM transform on the whole test run.
jest.mock('@ai-sdk/openai', () => ({ createOpenAI: jest.fn() }));

const hit = (over: Partial<any> = {}) => ({
  id: 1,
  fileUuid: 'uuid-1',
  summary: 'Sarah owns the pricing page',
  rawText: 'Sarah owns the pricing page',
  createdAt: new Date('2026-07-01'),
  similarity: 0.8,
  ...over,
});

describe('MemoryService', () => {
  let repo: jest.Mocked<MemoryRepository>;
  let service: MemoryService;
  const qr = {} as QueryRunner;

  beforeEach(() => {
    jest.clearAllMocks();
    generateTextMock.mockResolvedValue({ text: 'Sarah does. [1]' });
    generateObjectMock.mockResolvedValue({ object: { intent: 'ask' } });

    repo = {
      searchByEmbedding: jest.fn().mockResolvedValue([hit()]),
      listRecentNotes: jest.fn().mockResolvedValue([]),
      findEntitiesForTranscripts: jest.fn().mockResolvedValue([]),
      findEntityById: jest.fn(),
      findFactsForEntity: jest.fn().mockResolvedValue([]),
      findMentionsForEntity: jest.fn().mockResolvedValue([]),
      mergeEntities: jest.fn().mockResolvedValue({ mentionCount: 3 }),
      listEntities: jest.fn(),
      searchEntitiesByName: jest.fn(),
    } as unknown as jest.Mocked<MemoryRepository>;

    service = new MemoryService(
      repo,
      {
        createTurn: jest.fn().mockResolvedValue({}),
        listConversations: jest.fn().mockResolvedValue([]),
        listTurns: jest.fn().mockResolvedValue([]),
      } as any,
      { submitToQueue: jest.fn().mockResolvedValue({}) } as any,
      {
        getOrThrow: () => ({
          extractionModel: 'test/model',
          smartModel: 'test/smart-model',
        }),
      } as unknown as ConfigService<any>,
      { provider: () => 'model' } as any,
      { embed: jest.fn().mockResolvedValue([0.1, 0.2]) } as any,
    );
  });

  describe('ask', () => {
    /**
     * The product's central safety property, in its narrowed form. Yamin may now
     * answer a general question from its own understanding — that is the point of
     * the conversational lane — but it must never assert a fact about the USER's
     * life that no note contains.
     *
     * The old version of this test asserted the model was never called at all.
     * That was one IMPLEMENTATION of the guarantee, not the guarantee itself, and
     * it made "what should I do about burnout?" unanswerable. What must hold now:
     * with nothing retrieved, no user text reaches the prompt (nothing to
     * paraphrase into a false memory) and no sources are claimed.
     */
    it('sends no user memories and claims no sources when nothing is retrieved', async () => {
      repo.searchByEmbedding.mockResolvedValue([]);
      repo.listRecentNotes.mockResolvedValue([]);

      const result = await service.ask(
        { question: 'capital of France?' },
        3,
        qr,
      );

      const prompt = generateTextMock.mock.calls[0][0].prompt as string;
      expect(prompt).toMatch(/know NOTHING about this user's life/i);
      // The one thing that must not leak in: any of the user's own note text.
      expect(prompt).not.toContain('Sarah owns the pricing page');
      expect(result.sources).toEqual([]);
    });

    it('answers from retrieved memories and returns its sources', async () => {
      const result = await service.ask(
        { question: 'who owns pricing?' },
        3,
        qr,
      );

      expect(generateTextMock).toHaveBeenCalledTimes(1);
      expect(result.answer).toBe('Sarah does. [1]');
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].fileUuid).toBe('uuid-1');
    });

    it('grounds facts about the user in the notes while allowing general answers', () => {
      return service.ask({ question: 'who owns pricing?' }, 3, qr).then(() => {
        const prompt = generateTextMock.mock.calls[0][0].prompt as string;
        expect(prompt).toContain('Sarah owns the pricing page');
        // Facts about their life: notes only.
        expect(prompt).toMatch(/ONLY from the numbered memories/i);
        // And never laundered into sounding like something they said.
        expect(prompt).toMatch(/never dress up a general fact/i);
      });
    });

    /**
     * The contamination guard, and the one thing here a reviewer cannot verify by
     * reading the prompt: when nothing scores above the relevance floor, prepareAsk
     * silently substitutes the 20 most recent notes. Without a marker saying those
     * are NOT matches, "what should I do about burnout?" comes back as "Given your
     * Monday deadline with Karim…" — confidently irrelevant, which is worse than
     * an admission of ignorance.
     */
    it('marks recent-notes fallback as background, not as matches', async () => {
      repo.searchByEmbedding.mockResolvedValue([]);
      repo.listRecentNotes.mockResolvedValue([hit()]);

      await service.ask({ question: 'how do I handle burnout?' }, 3, qr);

      const prompt = generateTextMock.mock.calls[0][0].prompt as string;
      expect(prompt).toMatch(/No memory closely MATCHES this question/i);
      expect(prompt).toMatch(/fine to use none of them/i);
    });

    it('scopes retrieval to the asking user', async () => {
      await service.ask({ question: 'anything' }, 42, qr);
      expect(repo.searchByEmbedding).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 42 }),
        qr,
      );
    });
  });

  describe('search', () => {
    it('applies a similarity floor so a weak match is not presented as an answer', async () => {
      await service.search({ q: 'pricing' }, 3, qr);
      expect(repo.searchByEmbedding).toHaveBeenCalledWith(
        expect.objectContaining({ minSimilarity: 0.2 }),
        qr,
      );
    });

    it('lets the caller override the floor', async () => {
      await service.search({ q: 'pricing', minSimilarity: 0.5 }, 3, qr);
      expect(repo.searchByEmbedding).toHaveBeenCalledWith(
        expect.objectContaining({ minSimilarity: 0.5 }),
        qr,
      );
    });
  });

  describe('getEntity', () => {
    it("404s for an entity that isn't the user's", async () => {
      // findEntityById is userId-scoped, so a miss means absent-or-not-yours.
      // Both must look identical, or the API confirms other users' data exists.
      repo.findEntityById.mockResolvedValue(null);
      await expect(service.getEntity(3, 99, qr)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('mergeEntities', () => {
    const target = { id: 7, name: 'Pricing Page' };

    it('rejects merging an entity into itself', async () => {
      repo.findEntityById.mockResolvedValue(target as any);
      await expect(
        service.mergeEntities({ sourceIds: [7] }, 7, 3, qr),
      ).rejects.toThrow(BadRequestException);
      expect(repo.mergeEntities).not.toHaveBeenCalled();
    });

    it("refuses when the target is not the user's", async () => {
      repo.findEntityById.mockResolvedValue(null);
      await expect(
        service.mergeEntities({ sourceIds: [4] }, 7, 3, qr),
      ).rejects.toThrow(NotFoundException);
      expect(repo.mergeEntities).not.toHaveBeenCalled();
    });

    it("refuses — and moves nothing — if ANY source is not the user's", async () => {
      // The critical case: merge is a cross-row write. Getting ownership wrong
      // would splice one person's memories into another's.
      repo.findEntityById
        .mockResolvedValueOnce(target as any) // target ok
        .mockResolvedValueOnce({ id: 4 } as any) // source ok
        .mockResolvedValueOnce(null); // source belongs to someone else

      await expect(
        service.mergeEntities({ sourceIds: [4, 9999] }, 7, 3, qr),
      ).rejects.toThrow(NotFoundException);
      expect(repo.mergeEntities).not.toHaveBeenCalled();
    });

    it('merges when every id checks out', async () => {
      repo.findEntityById.mockResolvedValue(target as any);

      const result = await service.mergeEntities(
        { sourceIds: [4, 6] },
        7,
        3,
        qr,
      );

      expect(repo.mergeEntities).toHaveBeenCalledWith(
        { userId: 3, targetId: 7, sourceIds: [4, 6] },
        qr,
      );
      expect(result.merged).toBe(2);
      expect(result.entity.mentionCount).toBe(3);
    });
  });
});
