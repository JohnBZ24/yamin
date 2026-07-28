import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateObject, generateText, streamText } from 'ai';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { z } from 'zod';

import { AllConfigType } from '../config/config.type';
import { OpenRouterClient } from '../ai/openrouter.client';
import { EMBEDDING_PROVIDER } from '../ai/providers/embedding.provider';
import type { EmbeddingProvider } from '../ai/providers/embedding.provider';
import { normalizeEntityName } from '../voice/domain/graph-vocabulary';
import {
  MemoryRepository,
  MemoryHit,
} from './infrastructure/memory.repository';
import { ChatMessageRepository } from './infrastructure/chat-message.repository';
import { ReminderRepository } from '../voice/infrastructure/reminder.repository';
import { VoiceService } from '../voice/voice.service';
import { SearchMemoryDto } from './dto/search-memory.dto';
import { AskMemoryDto } from './dto/ask-memory.dto';
import { ConverseDto } from './dto/converse.dto';
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

/**
 * A note that failed to transcribe, or contained nothing, carries no
 * information — only a summary SAYING it contains nothing. Those summaries
 * ("This voice note is empty because…") are worse than useless in retrieval:
 * three of them in the context read as evidence the user's memory is empty.
 * New notes get filtered at write time (memorable=false → no embedding), but
 * rows written before that fix still match these older phrasings.
 */
const NO_SUBSTANCE_PATTERNS = [
  /^(the )?(voice )?note (does not|doesn't) contain/i,
  /voice note is empty/i,
  /impossible to extract/i,
  /no (specific|relevant|meaningful) (entities|information)/i,
  /nothing to (store|remember)/i,
];

function hasSubstance(row: {
  rawText: string | null;
  summary: string | null;
}): boolean {
  const body = row.rawText?.trim() || row.summary?.trim() || '';
  if (!body) return false;
  // The junk marker lives in the SUMMARY (that's where the extractor wrote
  // "this note is empty because…"), so test it as well as the body — a junk
  // note usually has perfectly innocent rawText like "you".
  const summary = row.summary?.trim() || '';
  return !NO_SUBSTANCE_PATTERNS.some(
    (re) => re.test(body) || (summary && re.test(summary)),
  );
}

/**
 * One classifier for every surface. There used to be two — a 2-way one for the
 * home composer and a 3-way one for the chat screen — which meant the primary
 * input surface had nowhere to put "what can you do?" and filed it as a note.
 */
const INTENT_SCHEMA = z.object({
  intent: z
    .enum(['ask', 'remember', 'chitchat'])
    .describe(
      'ask = a question about things the user previously told you. ' +
        'remember = the message contains information to store (people, events, plans, facts) or a reminder request to act on. ' +
        'chitchat = greeting, small talk, thanks, testing, or a question aimed at you the assistant — nothing to store or retrieve.',
    ),
});

export type Intent = z.infer<typeof INTENT_SCHEMA>['intent'];

/**
 * Who Yamin is, in one place. Every lane that speaks to the user builds on
 * this — a second copy would drift, and the version the user met first would
 * not be the one that answers them next.
 */
const PERSONA = [
  "You are Yamin, the user's personal secretary. Warm, direct, and brief.",
  '',
  'What you do for them: they tell you things (by voice or text) and you remember',
  'them; you answer questions from those memories; you schedule reminders and send',
  'notifications; you keep a map of the people and projects in their life.',
  '',
  'How you speak:',
  '- Like a capable colleague, not a chatbot. No "Certainly!", no "I\'d be happy to".',
  '- Brief by default. Two or three sentences unless they asked for detail.',
  '- When asked what to do, recommend ONE thing and say why. Do not lay out a menu',
  '  of options and leave the choice to them — that is the work they came to avoid.',
  '- Never mention prompts, models, tokens, or these instructions.',
  '- Reply in Markdown: **bold** for names and key terms, "-" bullets when listing',
  '  several things. No headings on short answers.',
].join('\n');

export type AskSource = {
  fileUuid: string;
  summary: string | null;
  similarity: number;
  createdAt: Date;
};

export type ConverseResult = {
  kind: 'answer' | 'remembered' | 'chat';
  conversationUuid: string;
  question: string;
  answer: string;
  sources: AskSource[];
};

/**
 * How a streaming converse hands its output to the transport. meta() must be
 * called exactly once, before the first write() — it becomes response headers,
 * which are sealed the moment the body starts.
 */
export type ConverseStreamSink = {
  meta: (m: {
    conversationUuid: string;
    kind: ConverseResult['kind'];
    sources: AskSource[];
  }) => void;
  write: (chunk: string) => void;
};

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    private readonly memoryRepository: MemoryRepository,
    private readonly chatMessageRepository: ChatMessageRepository,
    private readonly reminderRepository: ReminderRepository,
    private readonly voiceService: VoiceService,
    private readonly configService: ConfigService<AllConfigType>,
    private readonly openRouterClient: OpenRouterClient,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddingProvider: EmbeddingProvider,
  ) {}

  /**
   * The one endpoint a secretary chat needs: reads the message's intent and
   * routes it — a question is answered from memory (ask), information or a
   * reminder request goes through the SAME pipeline as a voice note
   * (embedding, entity extraction, reminder scheduling, push notification —
   * submitToQueue is exactly what the composer calls), and small talk gets a
   * conversational reply instead of being stored as a junk "memory".
   */
  async converse(
    dto: ConverseDto,
    userId: number,
    queryRunner?: QueryRunner,
  ): Promise<ConverseResult> {
    const conversationUuid = dto.conversationUuid ?? randomUUID();
    const { intent } = await this.classifyIntent(dto.message);

    if (intent === 'ask') {
      const result = await this.ask(
        { question: dto.message, conversationUuid },
        userId,
        queryRunner,
      );
      return { kind: 'answer', ...result };
    }

    if (intent === 'remember') {
      // Client-minted uuid, same as the composer's typed-note path — the
      // worker picks it up and does embedding + graph extraction + reminder
      // tools, so anything remembered here shows up in the feed, the graph,
      // and (if it was a reminder) as a real notification.
      const fileUuid = randomUUID();
      await this.voiceService.submitToQueue(
        { fileUuid, rawText: dto.message, timezone: dto.timezone },
        userId,
        queryRunner,
      );

      const answer =
        "Got it — I'll remember that. If it includes a reminder, I'll schedule it and notify you.";
      await this.chatMessageRepository.createTurn(
        {
          userId,
          conversationUuid,
          question: dto.message,
          answer,
          sources: [],
        },
        queryRunner,
      );
      return {
        kind: 'remembered',
        conversationUuid,
        question: dto.message,
        answer,
        sources: [],
      };
    }

    const result = await this.reply(
      { message: dto.message, conversationUuid },
      userId,
      queryRunner,
    );
    return { kind: 'chat', ...result };
  }

  /**
   * The lane for everything that is neither a memory nor a question about the
   * user's life: greetings, "what can you do?", "should I take the job?".
   *
   * It answers from Yamin's own understanding and returns no sources, which is
   * the honest signal — `sources: []` is what the UI uses to label an answer as
   * general rather than drawn from the user's notes.
   */
  async reply(
    dto: { message: string; conversationUuid?: string },
    userId: number,
    queryRunner?: QueryRunner,
  ): Promise<{
    conversationUuid: string;
    question: string;
    answer: string;
    sources: AskSource[];
  }> {
    const conversationUuid = dto.conversationUuid ?? randomUUID();
    const recent = await this.recentTurns(
      userId,
      conversationUuid,
      queryRunner,
    );
    const reminders = await this.remindersBlock(userId, queryRunner);

    const ai = this.configService.getOrThrow('ai', { infer: true });
    const { text } = await generateText({
      model: this.openRouterClient.provider(ai.smartModel),
      // Some warmth here, unlike the ask lane: this is conversation, and a
      // greeting answered identically every time reads as a canned response.
      temperature: 0.4,
      prompt: this.replyPrompt(dto.message, recent, reminders),
    });

    await this.persistTurn(
      userId,
      conversationUuid,
      dto.message,
      text,
      [],
      queryRunner,
    );

    return {
      conversationUuid,
      question: dto.message,
      answer: text,
      sources: [],
    };
  }

  /** reply(), streaming. */
  async replyStream(
    dto: { message: string; conversationUuid?: string },
    userId: number,
    sink: ConverseStreamSink,
    queryRunner?: QueryRunner,
  ): Promise<void> {
    const conversationUuid = dto.conversationUuid ?? randomUUID();
    const recent = await this.recentTurns(
      userId,
      conversationUuid,
      queryRunner,
    );
    const reminders = await this.remindersBlock(userId, queryRunner);

    sink.meta({ conversationUuid, kind: 'chat', sources: [] });

    const ai = this.configService.getOrThrow('ai', { infer: true });
    const result = streamText({
      model: this.openRouterClient.provider(ai.smartModel),
      temperature: 0.4,
      prompt: this.replyPrompt(dto.message, recent, reminders),
    });
    for await (const chunk of result.textStream) {
      sink.write(chunk);
    }

    await this.persistTurn(
      userId,
      conversationUuid,
      dto.message,
      await result.text,
      [],
      queryRunner,
    );
  }

  /** One source of truth for the conversational persona — reply() and replyStream() both speak with it. */
  private replyPrompt(
    message: string,
    recent: Array<{ question: string; answer: string }>,
    reminders: string[] = [],
  ): string {
    return [
      PERSONA,
      '',
      "This message is NOT a question about the user's stored notes — it is small",
      'talk, a question about you, or a request for your view on something general.',
      'Answer it properly; do not deflect to "I only know what you tell me".',
      '',
      'Rules:',
      '- Answer from your own understanding. You may give opinions and advice.',
      '- Never claim the user told you something. You are not looking at their notes',
      '  right now, so any specific name, date, or number about THEIR life would be',
      '  invented. Talk in general terms instead.',
      ...(reminders.length
        ? [
            '- The one exception is the reminder list below. Those are YOUR actions,',
            '  not their notes, and they are real — use them freely.',
          ]
        : []),
      '- If they ask what you can do, answer concretely and briefly — remembering',
      '  what they tell you, answering from it later, reminders, the people map.',
      '  Two or three sentences, not a feature list.',
      '- If they are clearly about to tell you something, invite it in one clause.',
      '  No sales pitch every turn.',
      '',
      ...(recent.length
        ? [
            'The conversation so far:',
            ...recent.map((t) => `User: ${t.question}\nYamin: ${t.answer}`),
            '',
          ]
        : []),
      ...reminders,
      `User: ${message}`,
    ].join('\n');
  }

  /**
   * What Yamin has done for this user, as opposed to what the user told it.
   *
   * Reminders are the one thing Yamin acts on by itself, and until the reminder
   * table existed they were pure fire-and-forget: a BullMQ job that ran and was
   * deleted. Asked "what did you remind me about?", the model went looking
   * through the user's NOTES — where the answer never was — and said it had
   * nothing. This block is the missing half of its memory, and it goes into
   * every lane that talks to the user, because the question arrives on all of
   * them.
   *
   * Returns [] when there is nothing, so callers can spread it away entirely
   * rather than assert an empty list the model then has to reason about.
   */
  private async remindersBlock(
    userId: number,
    queryRunner?: QueryRunner,
  ): Promise<string[]> {
    let past: Awaited<
      ReturnType<ReminderRepository['listForAiContext']>
    >['past'] = [];
    let upcoming: typeof past = [];

    try {
      ({ past, upcoming } = await this.reminderRepository.listForAiContext(
        { userId },
        queryRunner,
      ));
    } catch (error) {
      // Never fail an answer over the reminder sidecar — the memories are the
      // main event and this is context on top of them.
      this.logger.warn(
        `Could not load reminders for context: ${(error as Error).message}`,
      );
      return [];
    }

    if (past.length === 0 && upcoming.length === 0) return [];

    const line = (r: (typeof past)[number], label: string) => {
      const zone = r.timezone ?? 'UTC';
      const when = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(r.scheduledFor));
      return `- ${label} ${when} (${zone}) — "${r.title}"`;
    };

    return [
      '',
      'REMINDERS YOU HANDLED FOR THIS USER — your own record of what you did,',
      'not something they wrote down. SENT means you already notified them;',
      'UPCOMING means it is scheduled and has not fired yet.',
      ...past.map((r) =>
        line(r, r.status === 'sent' ? 'SENT' : r.status.toUpperCase()),
      ),
      ...upcoming.map((r) => line(r, 'UPCOMING')),
      '',
      'When they ask what you reminded them about, what you have set, or whether',
      'you notified them — answer from THIS list. It is complete and it is yours.',
      'Never say you have no record of your reminders while this list has entries,',
      'and never go looking for them in the memories: they were never stored there.',
    ];
  }

  /** The tail of this conversation, for continuity across turns. */
  private async recentTurns(
    userId: number,
    conversationUuid: string,
    queryRunner?: QueryRunner,
    take = 6,
  ): Promise<Array<{ question: string; answer: string }>> {
    const turns = await this.chatMessageRepository.listTurns(
      { userId, conversationUuid },
      queryRunner,
    );
    return turns.slice(-take);
  }

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
   * Is this something to remember, something to answer from their notes, or
   * something to just reply to?
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
  async classifyIntent(text: string): Promise<{ intent: Intent }> {
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
          'Reply "ask" when the user wants information back out of THEIR OWN memory:',
          'what they said, who someone is, what is outstanding.',
          '  "what did I say about pricing" -> ask',
          '  "when is the invoice due" -> ask',
          '  "who is Sarah" -> ask',
          '  "what do you know about me" -> ask (it is about THEIR life, not about you)',
          '  "what reminders did you set for me" -> ask (asking for something back,',
          '    not asking you to schedule anything new)',
          '  "did you remind me about the dentist?" -> ask',
          '',
          'Reply "remember" when the user is telling you something to keep, or',
          'asking you to do something for them:',
          '  "the invoice is due friday" -> remember',
          '  "remind me to call the dentist" -> remember',
          '  "met Sarah from Acme today" -> remember',
          '',
          'Reply "chitchat" for greetings, thanks, testing, questions aimed at YOU,',
          'and requests for general advice or opinion that do not depend on their notes:',
          '  "hey" / "how are you?" / "thanks!" -> chitchat',
          '  "what can you do?" / "who are you?" -> chitchat',
          '  "how should I handle a tough conversation?" -> chitchat',
          '',
          'When a message both greets AND carries information ("hey! btw the demo',
          'moved to friday"), the information wins: remember.',
          '',
          'If torn between chitchat and remember, answer "remember": a lost note is',
          'unrecoverable, while a mis-stored greeting is one row the user can delete.',
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

  /**
   * Retrieval + prompt assembly, shared by the JSON ask() and the streaming
   * askStream() so the two paths can never drift apart.
   */
  private async prepareAsk(
    dto: AskMemoryDto,
    userId: number,
    queryRunner?: QueryRunner,
  ): Promise<{
    conversationUuid: string;
    prompt: string;
    sources: AskSource[];
  }> {
    // Every turn persists under a conversation id so the chat is reopenable —
    // an answer that vanishes on navigation isn't memory.
    const conversationUuid = dto.conversationUuid ?? randomUUID();
    const limit = dto.limit ?? 6;
    const { results } = await this.search(
      { q: dto.question, limit },
      userId,
      queryRunner,
    );

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

    // WHY these rows are here, which the prompt must know. Recent-notes rows
    // are NOT answers to the question — they are background that happened to be
    // latest. Without this distinction "what should I do about burnout?" gets
    // answered with "Given your Monday deadline with Karim…", because the model
    // cannot tell a padded context from a relevant one.
    let grounding: 'matched' | 'recent' | 'none' = isFocused
      ? 'matched'
      : 'recent';

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
      grounding = 'none';
    }

    // The turns so far in THIS chat. Without them, a follow-up like
    // "operation of what?" arrives with no thread to hang on — the model sees
    // a three-word question and memories, but not the exchange about Andrew
    // that the question continues.
    const recentTurns = (
      await this.chatMessageRepository.listTurns(
        { userId, conversationUuid },
        queryRunner,
      )
    ).slice(-4);

    const reminders = await this.remindersBlock(userId, queryRunner);

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

    // MUST be `chronological`, the same order the model was shown. The answer
    // cites "[2]" by position in that list, so returning the
    // similarity-ranked order here would point every citation at the wrong
    // memory in the UI.
    const sources = chronological.map((result) => ({
      fileUuid: result.fileUuid,
      summary: result.summary,
      similarity: result.similarity,
      createdAt: result.createdAt,
    }));

    // The memories block reads differently depending on WHY those rows are
    // there. Getting this wrong in the "recent" case is the difference between
    // a general answer and a confidently irrelevant one.
    const memoriesBlock: string[] = {
      matched: () => ['Memories:', context],
      recent: () => [
        'No memory closely MATCHES this question. The notes below are simply the',
        'most recent ones, included as background. Use one only if it genuinely',
        'bears on what was asked — it is perfectly fine to use none of them and',
        'answer generally. Do not force them into the answer.',
        '',
        'Recent notes:',
        context,
      ],
      none: () => [
        "Memories: none. You currently know NOTHING about this user's life —",
        'no people, no plans, no events. Answer the general part of their question',
        'from your own understanding, and say plainly that you have nothing stored',
        'on it yet.',
      ],
    }[grounding]();

    const prompt = [
      PERSONA,
      '',
      'Who is who — read the question with these fixed:',
      '- "I", "me", "my" in the question mean THE USER. Every memory below is',
      "  something the user said. They are the user's stories, not yours.",
      '- "you", "your" in the question mean YOU, Yamin. You have no memories or',
      '  stories of your own — you only hold theirs.',
      '- So "what did I tell you about X" = "what did the USER say about X".',
      '  Never read it as you having told them something. Never answer that you',
      '  have no memories of your own; that is not what is being asked.',
      '',
      'You answer in two different registers, and must not mix them up:',
      '',
      '1. THEIR LIFE — the people, plans, events, and facts of this user.',
      '   This comes ONLY from the numbered memories. Never guess a name, date,',
      '   number, or relationship that is not written there. Cite what you use',
      '   as [1], [2]. If the memories do not answer it, say so plainly.',
      '   Never dress up a general fact as something they told you.',
      '',
      '2. EVERYTHING ELSE — what you are, how something works, general knowledge,',
      '   advice, your opinion. Answer from your own understanding. Cite nothing.',
      '',
      'Make the seam visible in your wording, so they always know which they got:',
      '  "You told me **Karim** wants the report Monday [1]" — from their notes.',
      '  "I don\'t have anything from you on that, but generally…" — your own.',
      '',
      'Reading the memories:',
      '- They are in the order they were recorded, oldest first.',
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
      '- Keep citations [1] as plain inline text.',
      '',
      ...(recentTurns.length
        ? [
            'The conversation so far — a short question like "operation of what?" or',
            '"and his mom?" continues THIS thread; read it that way:',
            ...recentTurns.map(
              (t) => `User: ${t.question}\nYamin: ${t.answer}`,
            ),
            '',
          ]
        : []),
      `Question: ${dto.question}`,
      '',
      ...memoriesBlock,
      ...reminders,
    ].join('\n');

    return { conversationUuid, prompt, sources };
  }

  private async persistTurn(
    userId: number,
    conversationUuid: string,
    question: string,
    answer: string,
    sources: AskSource[],
    queryRunner?: QueryRunner,
  ): Promise<void> {
    await this.chatMessageRepository.createTurn(
      {
        userId,
        conversationUuid,
        question,
        answer,
        sources: sources.map((s) => ({
          ...s,
          createdAt: new Date(s.createdAt).toISOString(),
        })),
      },
      queryRunner,
    );
  }

  async ask(
    dto: AskMemoryDto,
    userId: number,
    queryRunner?: QueryRunner,
  ): Promise<{
    conversationUuid: string;
    question: string;
    answer: string;
    sources: AskSource[];
  }> {
    const prep = await this.prepareAsk(dto, userId, queryRunner);

    const ai = this.configService.getOrThrow('ai', { infer: true });
    const { text } = await generateText({
      model: this.openRouterClient.provider(ai.smartModel),
      // Answers are grounded strictly in retrieved notes, so there is nothing
      // to be gained from sampling variety — only the risk of drifting off the
      // sources on some runs and not others.
      temperature: 0,
      prompt: prep.prompt,
    });

    await this.persistTurn(
      userId,
      prep.conversationUuid,
      dto.question,
      text,
      prep.sources,
      queryRunner,
    );

    return {
      conversationUuid: prep.conversationUuid,
      question: dto.question,
      answer: text,
      sources: prep.sources,
    };
  }

  /**
   * ask(), but the answer leaves as it is generated — the difference between
   * staring at a spinner for eight seconds and watching the reply type itself.
   * The full text still persists as one normal turn when the stream ends.
   */
  async askStream(
    dto: AskMemoryDto,
    userId: number,
    sink: ConverseStreamSink,
    queryRunner?: QueryRunner,
  ): Promise<void> {
    const prep = await this.prepareAsk(dto, userId, queryRunner);

    // Meta must go out before the first text byte — it rides the response
    // HEADERS, which are sealed the moment the body starts.
    sink.meta({
      conversationUuid: prep.conversationUuid,
      kind: 'answer',
      sources: prep.sources,
    });

    const ai = this.configService.getOrThrow('ai', { infer: true });
    const result = streamText({
      model: this.openRouterClient.provider(ai.smartModel),
      temperature: 0,
      prompt: prep.prompt,
    });
    for await (const chunk of result.textStream) {
      sink.write(chunk);
    }

    await this.persistTurn(
      userId,
      prep.conversationUuid,
      dto.question,
      await result.text,
      prep.sources,
      queryRunner,
    );
  }

  /**
   * converse(), streaming. Same three lanes; the reply reaches the client as
   * it is generated. The remember lane is inherently one chunk (its reply is
   * canned — the real work happens in the queue), ask and chitchat stream.
   */
  async converseStream(
    dto: ConverseDto,
    userId: number,
    sink: ConverseStreamSink,
    queryRunner?: QueryRunner,
  ): Promise<void> {
    const conversationUuid = dto.conversationUuid ?? randomUUID();
    const { intent } = await this.classifyIntent(dto.message);

    if (intent === 'ask') {
      await this.askStream(
        { question: dto.message, conversationUuid },
        userId,
        sink,
        queryRunner,
      );
      return;
    }

    if (intent === 'remember') {
      const fileUuid = randomUUID();
      await this.voiceService.submitToQueue(
        { fileUuid, rawText: dto.message, timezone: dto.timezone },
        userId,
        queryRunner,
      );
      const answer =
        "Got it — I'll remember that. If it includes a reminder, I'll schedule it and notify you.";
      sink.meta({ conversationUuid, kind: 'remembered', sources: [] });
      sink.write(answer);
      await this.persistTurn(
        userId,
        conversationUuid,
        dto.message,
        answer,
        [],
        queryRunner,
      );
      return;
    }

    await this.replyStream(
      { message: dto.message, conversationUuid },
      userId,
      sink,
      queryRunner,
    );
  }

  /** The user's past chats, newest first — one row per conversation. */
  async listChats(userId: number, limit = 30, queryRunner?: QueryRunner) {
    return this.chatMessageRepository.listConversations(
      { userId, limit },
      queryRunner,
    );
  }

  /** Every turn of one conversation, oldest first. */
  async getChat(
    userId: number,
    conversationUuid: string,
    queryRunner?: QueryRunner,
  ) {
    const turns = await this.chatMessageRepository.listTurns(
      { userId, conversationUuid },
      queryRunner,
    );
    if (turns.length === 0) {
      // Scoped by userId in the query — absent and someone-else's look the
      // same, deliberately.
      throw new NotFoundException('Conversation not found');
    }
    return turns.map((turn) => ({
      question: turn.question,
      answer: turn.answer,
      sources: turn.sources,
      createdAt: turn.createdAt,
    }));
  }

  /** Reminders Yamin has set for this user: soonest upcoming first, then history. */
  async listReminders(userId: number, limit = 20, queryRunner?: QueryRunner) {
    return this.reminderRepository.listForUser({ userId, limit }, queryRunner);
  }

  async listEntities(userId: number, limit = 50, queryRunner?: QueryRunner) {
    return this.memoryRepository.listEntities({ userId, limit }, queryRunner);
  }

  /**
   * The whole knowledge graph in one call: top entities plus every relation
   * among them. One round-trip instead of the N+1 the per-entity endpoint
   * would force on a graph view.
   */
  async getGraph(userId: number, limit = 60, queryRunner?: QueryRunner) {
    const nodes = await this.memoryRepository.listEntities(
      { userId, limit },
      queryRunner,
    );
    const edges = await this.memoryRepository.listEdgesAmong(
      { userId, nodeIds: nodes.map((node) => node.id) },
      queryRunner,
    );
    return { nodes, edges };
  }

  async findEntities(
    userId: number,
    q: string,
    limit = 20,
    queryRunner?: QueryRunner,
  ) {
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
