import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateObject, generateText } from 'ai';
import { QueryRunner } from 'typeorm';
import { z } from 'zod';

import { AllConfigType } from '../config/config.type';
import { OpenRouterClient } from '../ai/openrouter.client';
import { EMBEDDING_PROVIDER } from '../ai/providers/embedding.provider';
import type { EmbeddingProvider } from '../ai/providers/embedding.provider';
import { normalizeEntityName } from '../voice/domain/graph-vocabulary';
import { MemoryRepository, MemoryHit } from './infrastructure/memory.repository';
import { SearchMemoryDto } from './dto/search-memory.dto';
import { AskMemoryDto } from './dto/ask-memory.dto';
import { MergeEntitiesDto } from './dto/merge-entities.dto';

export type SearchResult = MemoryHit & {
  entities: Array<{ id: number; name: string; type: string }>;
};

/**
 * Below this, a hit is noise rather than an answer. The search floor is 0.2,
 * which is right for "show me anything related" but far too loose to answer
 * from — a 30% match contributed nothing except the impression that the
 * memory was empty.
 */
const RELEVANCE_FLOOR = 0.45;

/** A note that failed to transcribe carries no information, only a summary saying so. */
function hasSubstance(row: { rawText: string | null; summary: string | null }): boolean {
  const body = row.rawText?.trim() || row.summary?.trim() || '';
  if (!body) return false;
  return !/^(the )?(voice )?note (does not|doesn't) contain/i.test(body);
}

const INTENT_SCHEMA = z.object({
  intent: z
    .enum(['ask', 'remember'])
    .describe('ask = retrieve from memory; remember = store, or act on, what was said'),
});

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    private readonly memoryRepository: MemoryRepository,
    private readonly configService: ConfigService<AllConfigType>,
    private readonly openRouterClient: OpenRouterClient,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddingProvider: EmbeddingProvider,
  ) {}

  /**
   * Semantic search across the user's notes, with the graph context attached.
   *
   * The query is embedded with the *same* model that embedded the notes. That
   * isn't incidental: vectors from two different models are not comparable, so
   * changing AI_EMBEDDING_MODEL invalidates every stored embedding and requires
   * a re-embed of the whole table.
   */
  async search(
    dto: SearchMemoryDto,
    userId: number,
    queryRunner?: QueryRunner,
  ): Promise<{ query: string; results: SearchResult[] }> {
    const limit = dto.limit ?? 10;
    const embedding = await this.embeddingProvider.embed(dto.q);

    const hits = await this.memoryRepository.searchByEmbedding(
      {
        userId,
        embedding,
        limit,
        // Cosine similarity on unit vectors: everything scores > 0, so with no
        // floor the "worst" match still comes back and looks like an answer.
        // A weak match presented confidently is worse than "I don't know".
        minSimilarity: dto.minSimilarity ?? 0.2,
      },
      queryRunner,
    );

    const entitiesByTranscript = await this.loadEntities(
      userId,
      hits.map((hit) => hit.id),
      queryRunner,
    );

    return {
      query: dto.q,
      results: hits.map((hit) => ({
        ...hit,
        entities: entitiesByTranscript.get(hit.id) ?? [],
      })),
    };
  }

  /**
   * The actual secretary: answer a question from the user's own memories.
   *
   * Grounded strictly in retrieved notes and told to say when it doesn't know.
   * An AI secretary that invents a meeting you never had is worse than useless
   * — it's a liability — so the prompt forbids outside knowledge and the
   * response always carries its sources for the user to check.
   */
  /**
   * Is this something to remember, or something to answer?
   *
   * The app used to make the user declare it with a toggle before typing, which
   * is work the model can do. Punctuation alone is not enough — "remind me when
   * the invoice is due" is a request to store, "when is the invoice due" is a
   * question, and neither is reliably marked by a '?'.
   *
   * Biased toward 'remember' on purpose. Mistaking a note for a question loses
   * data the user meant to keep; mistaking a question for a note stores one
   * junk row and shows an unhelpful reply, which the user can see and delete.
   */
  async classifyIntent(text: string): Promise<{ intent: 'ask' | 'remember' }> {
    const trimmed = text.trim();
    if (!trimmed) {
      return { intent: 'remember' };
    }

    const ai = this.configService.getOrThrow('ai', { infer: true });

    try {
      const { object } = await generateObject({
        model: this.openRouterClient.provider(ai.extractionModel),
        schema: INTENT_SCHEMA,
        // Routing must be stable: the same sentence flipping between "ask" and
        // "remember" on different runs is indistinguishable from the feature
        // being broken.
        temperature: 0,
        prompt: [
          'You route one message for a personal memory assistant.',
          '',
          'Reply "ask" when the user wants information back out of their memory:',
          'questions about what they said, who someone is, what is outstanding.',
          '  "what did I say about pricing" -> ask',
          '  "when is the invoice due" -> ask',
          '  "who is Sarah" -> ask',
          '',
          'Reply "remember" when the user is telling you something to keep, or',
          'asking you to do something for them:',
          '  "the invoice is due friday" -> remember',
          '  "remind me to call the dentist" -> remember',
          '  "met Sarah from Acme today" -> remember',
          '',
          'If it is genuinely ambiguous, answer "remember".',
          '',
          `Message: ${trimmed}`,
        ].join('\n'),
      });

      return { intent: object.intent };
    } catch (error) {
      // Never lose the user's words to a classifier outage — storing it is the
      // recoverable direction.
      this.logger.warn(
        `Intent classification failed, defaulting to remember: ${(error as Error).message}`,
      );
      return { intent: 'remember' };
    }
  }

  async ask(
    dto: AskMemoryDto,
    userId: number,
    queryRunner?: QueryRunner,
  ): Promise<{
    question: string;
    answer: string;
    sources: Array<{ fileUuid: string; summary: string | null; similarity: number; createdAt: Date }>;
  }> {
    const limit = dto.limit ?? 6;
    const { results } = await this.search({ q: dto.question, limit }, userId, queryRunner);

    // A note whose transcription produced nothing carries no information, but
    // its summary still reads "does not contain any discernible information" —
    // and three of those in the context is active evidence of absence. They
    // pushed the model to answer "there is nothing in your memories" while real
    // notes sat further down the list.
    const usable = results.filter(hasSubstance);

    // Similarity search answers "what did I say about X". It cannot answer
    // "what have I told you about" — that is a question about the whole corpus,
    // where nothing scores highly because no single note resembles the phrasing.
    // When nothing is strongly relevant, hand over the recent notes themselves
    // instead of a handful of weak matches.
    const isFocused = usable.some((r) => r.similarity >= RELEVANCE_FLOOR);
    let rows: SearchResult[] = usable;

    if (!isFocused) {
      const recent = (
        await this.memoryRepository.listRecentNotes(
          { userId, limit: Math.max(limit, 20) },
          queryRunner,
        )
      ).filter(hasSubstance);

      // The graph context around each note, same as search() attaches — the
      // entity names are what let the model group "the stories" by who they
      // are about.
      const entitiesByTranscript = await this.loadEntities(
        userId,
        recent.map((hit) => hit.id),
        queryRunner,
      );
      rows = recent.map((hit) => ({
        ...hit,
        entities: entitiesByTranscript.get(hit.id) ?? [],
      }));
    }

    if (rows.length === 0) {
      // Deliberately short-circuited: with no context the model would answer
      // from its own world knowledge, and a confident answer sourced from
      // nothing is exactly the failure this product cannot afford.
      return {
        question: dto.question,
        answer:
          "I don't have any memories about that yet. Tell me about it and I'll remember.",
        sources: [],
      };
    }

    const ai = this.configService.getOrThrow('ai', { infer: true });

    // Oldest first, so the reading order IS the chronology. Retrieval ranks by
    // similarity, which left "Fady likes X" and "Fady dislikes X" side by side
    // with no cue as to which came later — and the model, told only to refuse
    // when memories disagree, refused. A memory that cannot be updated is not
    // much of a memory.
    const chronological = rows.toSorted(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    // Minutes, not just the date. Two notes on the same day are the normal case
    // for one train of thought, and a date alone cannot order them.
    const context = chronological
      .map((result, index) => {
        const when = new Date(result.createdAt)
          .toISOString()
          .slice(0, 16)
          .replace('T', ' ');
        const who = result.entities.map((e) => e.name).join(', ') || 'none';
        return [
          `[${index + 1}] (recorded ${when} UTC, similarity ${result.similarity.toFixed(2)})`,
          `entities: ${who}`,
          `note: ${result.rawText ?? result.summary ?? ''}`,
        ].join('\n');
      })
      .join('\n\n');

    const { text } = await generateText({
      model: this.openRouterClient.provider(ai.extractionModel),
      // Answers are grounded strictly in retrieved notes, so there is nothing
      // to be gained from sampling variety — only the risk of drifting off the
      // sources on some runs and not others.
      temperature: 0,
      prompt: [
        "You are Yamin, the user's personal secretary. Answer their question using ONLY the memories below.",
        '',
        'Who is who — read the question with these fixed:',
        '- "I", "me", "my" in the question mean THE USER. Every memory below is',
        '  something the user said. They are the user\'s stories, not yours.',
        '- "you", "your" in the question mean YOU, Yamin. You have no memories or',
        '  stories of your own — you only hold theirs.',
        '- So "what did I tell you about X" = "what did the USER say about X".',
        '  Never read it as you having told them something. Never answer that you',
        '  have no memories of your own; that is not what is being asked.',
        '',
        'Rules:',
        '- Use only the numbered memories. Never use outside knowledge.',
        '- The memories are in the order they were recorded, oldest first.',
        '- They are fragments of the user talking over time, not standalone facts.',
        '  A memory that starts mid-thought ("because...", "and then...") continues',
        '  the one recorded just before it. Read them together.',
        '- If two memories conflict, the LATER one wins — the user changed their',
        '  mind or corrected themselves. Answer with the current state. Mention the',
        '  change only if it is the point of the question. Never refuse because',
        '  memories disagree.',
        '- If the question asks for a recap of everything ("what have I told you",',
        '  "remind me of all the stories"), summarise the memories below as a short',
        '  grouped list of what the user has recorded. That IS the answer — do not',
        '  say you have nothing.',
        '- If they genuinely do not contain the answer, say so plainly. Do not guess.',
        '- Cite the memories you used as [1], [2].',
        '- Be brief and direct. Speak to the user as "you".',
        '',
        `Question: ${dto.question}`,
        '',
        'Memories:',
        context,
      ].join('\n'),
    });

    return {
      question: dto.question,
      answer: text,
      // MUST be `chronological`, the same order the model was shown. The answer
      // cites "[2]" by position in that list, so returning the
      // similarity-ranked order here would point every citation at the wrong
      // memory in the UI.
      sources: chronological.map((result) => ({
        fileUuid: result.fileUuid,
        summary: result.summary,
        similarity: result.similarity,
        createdAt: result.createdAt,
      })),
    };
  }

  async listEntities(userId: number, limit = 50, queryRunner?: QueryRunner) {
    return this.memoryRepository.listEntities({ userId, limit }, queryRunner);
  }

  async findEntities(userId: number, q: string, limit = 20, queryRunner?: QueryRunner) {
    return this.memoryRepository.searchEntitiesByName(
      { userId, normalizedQuery: normalizeEntityName(q), limit },
      queryRunner,
    );
  }

  /** "What do I know about John?" — the question the old schema couldn't answer. */
  async getEntity(userId: number, nodeId: number, queryRunner?: QueryRunner) {
    const entity = await this.memoryRepository.findEntityById(
      { userId, nodeId },
      queryRunner,
    );

    // Scoped by userId in the query, so a miss is either genuinely absent or
    // someone else's — both are a 404 here. Never confirm existence.
    if (!entity) {
      throw new NotFoundException('Entity not found');
    }

    const [facts, mentions] = await Promise.all([
      this.memoryRepository.findFactsForEntity({ userId, nodeId }, queryRunner),
      this.memoryRepository.findMentionsForEntity(
        { userId, nodeId, limit: 20 },
        queryRunner,
      ),
    ]);

    return { entity, facts, mentions };
  }

  /**
   * Fold duplicates into one entity. The repair for graphs written before
   * entity linking existed.
   *
   * Every id is re-checked against this user before anything moves. The merge
   * SQL is scoped by userId too, but that belt-and-braces is deliberate: a
   * merge is a cross-row write, and getting ownership wrong here would splice
   * one person's memories into another's — the worst possible bug in this
   * product.
   */
  async mergeEntities(
    dto: MergeEntitiesDto,
    targetId: number,
    userId: number,
    queryRunner: QueryRunner,
  ) {
    if (dto.sourceIds.includes(targetId)) {
      throw new BadRequestException('Cannot merge an entity into itself');
    }

    const target = await this.memoryRepository.findEntityById(
      { userId, nodeId: targetId },
      queryRunner,
    );
    if (!target) {
      throw new NotFoundException('Target entity not found');
    }

    for (const sourceId of dto.sourceIds) {
      const source = await this.memoryRepository.findEntityById(
        { userId, nodeId: sourceId },
        queryRunner,
      );
      // 404, never 403: confirming "that exists but isn't yours" would leak
      // that another user has an entity with this id.
      if (!source) {
        throw new NotFoundException(`Entity ${sourceId} not found`);
      }
    }

    const { mentionCount } = await this.memoryRepository.mergeEntities(
      { userId, targetId, sourceIds: dto.sourceIds },
      queryRunner,
    );

    this.logger.log(
      `Merged ${dto.sourceIds.length} entit(ies) into node ${targetId} for user ${userId}`,
    );

    return {
      merged: dto.sourceIds.length,
      entity: { ...target, mentionCount },
    };
  }

  private async loadEntities(
    userId: number,
    transcriptIds: number[],
    queryRunner?: QueryRunner,
  ): Promise<Map<number, Array<{ id: number; name: string; type: string }>>> {
    const rows = await this.memoryRepository.findEntitiesForTranscripts(
      { userId, transcriptIds },
      queryRunner,
    );

    const byTranscript = new Map<
      number,
      Array<{ id: number; name: string; type: string }>
    >();

    for (const row of rows) {
      const list = byTranscript.get(row.voiceTranscriptId) ?? [];
      list.push({ id: row.id, name: row.name, type: row.type });
      byTranscript.set(row.voiceTranscriptId, list);
    }

    return byTranscript;
  }
}
