import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { generateObject, generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';

import { AllConfigType } from '../config/config.type';
import { AiProviderKind } from '../config/ai-config.type';
import { OpenRouterClient } from '../ai/openrouter.client';
import { EMBEDDING_PROVIDER } from '../ai/providers/embedding.provider';
import type { EmbeddingProvider } from '../ai/providers/embedding.provider';
import { VoiceTranscriptRepository } from './infrastructure/voice-transcript.repository';
import { EntityNodeRepository } from './infrastructure/entity-node.repository';
import { EntityRelationRepository } from './infrastructure/entity-relation.repository';
import { NodeMentionRepository } from './infrastructure/node-mention.repository';
import {
  EntityNodeType,
  EntityRelationType,
  isSelfReference,
  normalizeEntityName,
} from './domain/graph-vocabulary';
import { REALTIME_NOTIFIER } from '../realtime/realtime.constants';
import type { RealtimeNotifier } from '../realtime/realtime.constants';
import { safeTransaction } from '../utils/queryRunner/querry-runner-release-mechanism';
import { describeNow, nextOccurrenceUtc, resolveTimezone } from '../utils/time/timezone';

/**
 * The extraction contract.
 *
 * `type` is an enum, not a free string. This is the fix for the un-joinable
 * graph: the schema is compiled to JSON Schema and handed to the model, so the
 * constraint is enforced at generation time. Previously the same sentence
 * yielded `Organization:Acme Corp` on one run and `Company:Acme Corp` on the
 * next — two rows, one company, no join.
 */
const EXTRACTION_SCHEMA = z.object({
  summary: z
    .string()
    .describe('A concise one-sentence summary of the voice note.'),
  nodes: z.array(
    z.object({
      type: z.enum(EntityNodeType).describe('The kind of entity.'),
      name: z
        .string()
        .describe(
          'Canonical name of the entity, e.g. "Sarah Okonkwo". Never a pronoun.',
        ),
      description: z
        .string()
        .optional()
        .describe('Short description of this entity in context.'),
    }),
  ),
  relations: z.array(
    z.object({
      sourceType: z.enum(EntityNodeType),
      sourceName: z
        .string()
        .describe('Must exactly match a name in the nodes array.'),
      targetType: z.enum(EntityNodeType),
      targetName: z
        .string()
        .describe('Must exactly match a name in the nodes array.'),
      type: z.enum(EntityRelationType),
      description: z.string().optional().describe('Context of the relationship'),
    }),
  ),
});

type ExtractedGraph = z.infer<typeof EXTRACTION_SCHEMA>;

@Processor('voice-processing')
@Injectable()
export class VoiceProcessor extends WorkerHost {
  private readonly logger = new Logger(VoiceProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly voiceRepository: VoiceTranscriptRepository,
    private readonly nodeRepository: EntityNodeRepository,
    private readonly relationRepository: EntityRelationRepository,
    private readonly mentionRepository: NodeMentionRepository,
    @Inject(REALTIME_NOTIFIER)
    private readonly notifier: RealtimeNotifier,
    private readonly configService: ConfigService<AllConfigType>,
    private readonly openRouterClient: OpenRouterClient,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddingProvider: EmbeddingProvider,
    @InjectQueue('reminders-queue') private readonly remindersQueue: Queue,
  ) {
    super();
  }

  private get isMockProvider(): boolean {
    return (
      this.configService.getOrThrow('ai', { infer: true }).provider ===
      AiProviderKind.Mock
    );
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { fileUuid, rawText, userId, timezone } = job.data;
    this.logger.log(`Processing voice note job ${job.id} for User ${userId}`);

    if (!rawText) {
      this.logger.warn(`Job ${job.id} rawText is empty. Skipping processing.`);
      await this.updateJobStatus(fileUuid, 'failed', 'Empty transcript received');
      return;
    }

    try {
      // 1. Calculate Embeddings
      const embedding = await this.calculateEmbeddings(rawText);

      // 2. Trigger Tools / Actions (e.g. Schedule reminders, create tasks)
      const reminderConfirmation = await this.triggerAiSecretaryTools(
        rawText,
        userId,
        timezone,
      );

      // 3. Extract Structured Graph (Summary, Nodes, Relations).
      // Entity linking: show the extractor what this user already talks about
      // so a second note about Sarah reuses "Sarah Okonkwo" rather than
      // inventing "Sarah from Acme" and fragmenting her into two people.
      const knownEntities = await this.nodeRepository.findLinkingCandidates({
        userId,
        limit: 60,
      });
      const graphData = await this.extractGraphRepresentation(
        rawText,
        knownEntities,
      );

      // A reminder that scheduled successfully had no visible trace anywhere in
      // the app — the note card just showed the summary as if nothing had
      // happened. Prefixing it here is the cheapest way to make "did that
      // actually get scheduled" answerable by looking at the note.
      const summary = reminderConfirmation
        ? `${reminderConfirmation}. ${graphData.summary}`
        : graphData.summary;

      // 4. Save to Database within a clean PostgreSQL transaction
      await safeTransaction(this.dataSource, async (queryRunner) => {
        const transcript = await this.voiceRepository.findOne({
          fields: { fileUuid } as any,
          queryRunner,
        });

        if (!transcript) {
          throw new Error(`Voice transcript record not found for UUID: ${fileUuid}`);
        }

        // Resolve each extracted node to the user's canonical entity, so a
        // second note about Sarah attaches to the same Sarah instead of
        // creating a second disconnected one.
        const nodeIdByKey = new Map<string, number>();

        for (const node of graphData.nodes ?? []) {
          const normalizedName = normalizeEntityName(node.name);

          if (!normalizedName || isSelfReference(normalizedName)) {
            // The graph belongs to one user already; a "You"/"me" node carries
            // no information and links unrelated memories into a hairball.
            continue;
          }

          const resolved = await this.nodeRepository.resolve(
            {
              userId,
              type: node.type,
              name: node.name.trim(),
              normalizedName,
              description: node.description || null,
            },
            queryRunner,
          );

          nodeIdByKey.set(this.nodeKey(node.type, normalizedName), resolved.id);

          await this.mentionRepository.record(
            {
              nodeId: resolved.id,
              voiceTranscriptId: transcript.id,
              description: node.description || null,
            },
            queryRunner,
          );
        }

        // Relations now join node ids, not name strings.
        let droppedRelations = 0;

        for (const rel of graphData.relations ?? []) {
          const sourceId = nodeIdByKey.get(
            this.nodeKey(rel.sourceType, normalizeEntityName(rel.sourceName)),
          );
          const targetId = nodeIdByKey.get(
            this.nodeKey(rel.targetType, normalizeEntityName(rel.targetName)),
          );

          // An endpoint the model never declared as a node, or one we dropped
          // as a self-reference. Skipping is correct — inventing the missing
          // node would resurrect the "You" hairball — but it's counted so this
          // can't quietly swallow half the graph.
          if (!sourceId || !targetId || sourceId === targetId) {
            droppedRelations += 1;
            continue;
          }

          await this.relationRepository.resolve(
            {
              userId,
              sourceNodeId: sourceId,
              targetNodeId: targetId,
              type: rel.type,
              description: rel.description || null,
              voiceTranscriptId: transcript.id,
            },
            queryRunner,
          );
        }

        if (droppedRelations > 0) {
          this.logger.warn(
            `Job ${job.id}: dropped ${droppedRelations}/${graphData.relations?.length ?? 0} relation(s) with unresolvable endpoints`,
          );
        }

        // Update the Voice Transcript record
        await this.voiceRepository.update(
          transcript.id,
          {
            status: 'processed',
            summary,
            embedding,
          },
          queryRunner,
        );
      });

      this.logger.log(`Job ${job.id} successfully processed and saved to database.`);

      // 5. Emit completed event to the user's socket client in real-time
      await this.notifier.sendToUser(userId, 'voice-processed', {
        fileUuid,
        status: 'processed',
        summary,
        nodes: graphData.nodes,
        relations: graphData.relations,
      });

    } catch (error) {
      this.logger.error(`Failed to process job ${job.id}: ${error.message}`, error.stack);

      // Only mark failed and tell the user once BullMQ has exhausted its
      // retries. Reporting on every attempt would flag a note as failed while
      // it is still going to be retried — and a note that succeeds on attempt 3
      // would have already shown the user two failure alerts.
      const maxAttempts = job.opts.attempts ?? 1;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

      if (isFinalAttempt) {
        await this.updateJobStatus(fileUuid, 'failed', error.message);
        await this.notifier.sendToUser(userId, 'voice-failed', {
          fileUuid,
          status: 'failed',
          error: error.message,
        });
      } else {
        this.logger.warn(
          `Job ${job.id} will retry (attempt ${job.attemptsMade + 1}/${maxAttempts})`,
        );
      }

      throw error;
    }
  }

  /**
   * Provider selection and mock behaviour live in AiModule; failures propagate.
   *
   * This previously caught API errors and returned
   *   Array(1536).fill(0).map(() => Math.random())
   * which was then written to the DB and marked `processed`. A transient 429
   * produced a random vector indistinguishable from a real one, forever, with
   * no way to identify the poisoned rows. Letting the error throw means BullMQ
   * retries with backoff and the note is recoverable.
   */
  private async calculateEmbeddings(text: string): Promise<number[]> {
    return this.embeddingProvider.embed(text);
  }

  /**
   * Returns a short confirmation ("Reminder set for 2:43 PM") when a reminder
   * was scheduled, so the caller can surface it — otherwise a reminder can
   * succeed with zero visible trace in the app.
   */
  private async triggerAiSecretaryTools(
    text: string,
    userId: number,
    timezoneHint?: string,
  ): Promise<string | null> {
    if (this.isMockProvider) {
      this.logger.warn('MOCK provider: skipping tool execution.');
      return null;
    }

    const ai = this.configService.getOrThrow('ai', { infer: true });
    const appConfig = this.configService.getOrThrow('app', { infer: true });
    const timezone = resolveTimezone(timezoneHint, appConfig.defaultTimezone);
    const now = new Date();

    // No try/catch. This used to swallow every error and continue, so the job
    // still reported success — meaning "remind me to call the bank" could fail
    // silently and Yamin would never remind them. A dropped reminder is a
    // trust-ending bug for a secretary; let it throw and let BullMQ retry.
    const result = await generateText({
      model: this.openRouterClient.provider(ai.extractionModel),
      // Deciding whether a note is a scheduling request, and at what time, must
      // not vary run to run — same reasoning as the extractor below.
      temperature: 0,
      prompt: [
        'You are Yamin, a smart AI Secretary.',
        `The current date and time is: ${describeNow(timezone, now)}.`,
        `Analyze the following voice note: "${text}"`,
        '',
        'If the user wants to be reminded of something and you can tell WHEN, call scheduleReminder.',
        '',
        'If they clearly want a reminder but the time is missing, ambiguous, or already',
        'past for today, call askAboutTime instead of guessing. Guessing a time is worse',
        'than asking: a reminder that fires at the wrong moment is the same as no reminder.',
        'Ask a short, specific question naming what you did understand.',
        '',
        'If it is not a scheduling request at all, call nothing — most notes are just',
        'something to remember.',
      ].join('\n'),
      // Lets the model produce a closing message after the tool result instead
      // of the run ending on the tool call.
      stopWhen: stepCountIs(3),
      tools: {
        scheduleReminder: tool({
          description:
            "Schedules a notification reminder for the user. Give EITHER atTime (the user named a clock time, e.g. '2:43pm', 'at 9') OR delayMinutes (the user gave a duration, e.g. 'in 45 minutes', 'in 2 hours') — never both, never neither.",
          // `inputSchema`, NOT `parameters`. The v4 name was silently accepted
          // because the object was cast `as any`, so the tool shipped with no
          // schema at all and the model could never call it — verified live: a
          // note saying "remind me in 45 minutes" queued zero reminder jobs.
          // The cast is gone so this can't regress unnoticed.
          inputSchema: z.object({
            title: z.string().describe('The reminder message/subject'),
            delayMinutes: z
              .number()
              .optional()
              .describe('Minutes from now. Use for a spoken DURATION.'),
            atTime: z
              .string()
              .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
              .optional()
              .describe(
                "24-hour HH:mm. Use for a spoken CLOCK TIME. Convert e.g. '2:43pm' to '14:43' yourself " +
                  '— do NOT compute a delay for this case, the server resolves it against the real clock.',
              ),
          }),
          execute: async ({ title, delayMinutes, atTime }) => {
            let target: Date;
            let describe: string;

            if (atTime) {
              const [h, m] = atTime.split(':').map(Number);
              target = nextOccurrenceUtc(h, m, timezone, now);
              describe = `at ${atTime} (${timezone})`;
            } else if (typeof delayMinutes === 'number' && delayMinutes >= 0) {
              target = new Date(now.getTime() + delayMinutes * 60_000);
              describe = `in ${delayMinutes} minute(s)`;
            } else {
              // Model called the tool without a usable time. Failing loud here
              // is what surfaces this as a bug instead of a silently-missed
              // reminder — the old code had no such guard.
              throw new Error(
                `scheduleReminder called with neither a valid atTime nor delayMinutes (got atTime=${atTime}, delayMinutes=${delayMinutes})`,
              );
            }

            const delayMs = Math.max(0, target.getTime() - now.getTime());

            // Content deliberately not logged — reminder titles are user PII
            // and stdout ships to a log aggregator with long retention.
            this.logger.log(
              `Scheduling reminder ${describe} (${Math.round(delayMs / 60_000)}m from now) for user ${userId}`,
            );
            await this.remindersQueue.add(
              'reminder-job',
              { title, userId },
              {
                delay: delayMs,
                attempts: 3,
                backoff: { type: 'exponential', delay: 5_000 },
                removeOnComplete: { age: 86_400 },
              },
            );

            // Includes the DAY whenever it isn't today. "Reminder set for 4:51 PM"
            // is indistinguishable from a reminder scheduled in the past when the
            // time has already gone by and it silently rolled to tomorrow — the
            // user reasonably read that as the app scheduling past dates.
            const sameDay =
              new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(target) ===
              new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);

            const clockLabel = new Intl.DateTimeFormat('en-US', {
              timeZone: timezone,
              hour: 'numeric',
              minute: '2-digit',
              ...(sameDay ? {} : { weekday: 'short', month: 'short', day: 'numeric' }),
            }).format(target);

            // Structured, not a bare string assigned to an outer closure
            // variable: this is read back out of `result.staticToolResults`
            // below, which is the SDK's own authoritative record of what each
            // tool call actually returned — not dependent on assuming exactly
            // how many times, or in what order, the SDK invokes `execute`.
            return {
              confirmation: `Reminder set for ${clockLabel}: "${title}"`,
              scheduledForIso: target.toISOString(),
            };
          },
        }),

        askAboutTime: tool({
          description:
            'Use when the user clearly wants a reminder but you cannot determine WHEN with confidence. Asks them instead of guessing. Never call this together with scheduleReminder.',
          inputSchema: z.object({
            question: z
              .string()
              .describe(
                'A short question naming what you understood, e.g. "When should I remind you about your friend\'s birthday?"',
              ),
          }),
          execute: async ({ question }) => {
            this.logger.log(`Asking user ${userId} to clarify a reminder time`);
            return { question };
          },
        }),
      },
    });

    const reminderResults = result.staticToolResults.filter(
      (r) => r.toolName === 'scheduleReminder',
    );
    const clarifyResults = result.staticToolResults.filter(
      (r) => r.toolName === 'askAboutTime',
    );

    this.logger.log(
      `Secretary tools: ${result.steps.length} step(s), ${reminderResults.length} reminder(s) scheduled, ${clarifyResults.length} question(s)`,
    );

    // If the model called it more than once in a run, surface all of them —
    // dropping to only the first would silently hide a second reminder that
    // genuinely got scheduled.
    if (reminderResults.length) {
      return reminderResults.map((r) => r.output.confirmation).join('; ');
    }
    // A question is only worth surfacing when nothing was actually scheduled;
    // if a reminder was set, the confirmation is the more useful message.
    if (clarifyResults.length) {
      return `❓ ${clarifyResults[0].output.question}`;
    }
    return null;
  }

  /** Resolution key: same thing, same type → same node. */
  private nodeKey(type: EntityNodeType, normalizedName: string): string {
    return `${type}::${normalizedName}`;
  }

  private async extractGraphRepresentation(
    text: string,
    knownEntities: Array<{ type: string; name: string }> = [],
  ): Promise<ExtractedGraph> {
    if (this.isMockProvider) {
      this.logger.warn('MOCK provider: returning fabricated graph.');
      return {
        summary: '[MOCK] This is a mock summary of the voice note.',
        nodes: [
          {
            type: EntityNodeType.Person,
            name: 'John Doe',
            description: 'Met during the meeting.',
          },
          {
            type: EntityNodeType.Project,
            name: 'Yamin',
            description: 'AI Secretary application.',
          },
        ],
        relations: [
          {
            sourceType: EntityNodeType.Person,
            sourceName: 'John Doe',
            targetType: EntityNodeType.Project,
            targetName: 'Yamin',
            type: EntityRelationType.PARTICIPANT_IN,
            description: 'John is working on the project.',
          },
        ],
      };
    }

    const ai = this.configService.getOrThrow('ai', { infer: true });

    // The known-entity list is the entity-linking mechanism. Without it the
    // model names each entity fresh per note ("pricing page" / "Pricing Page" /
    // "Pricing Page Completion" — observed live), and since the resolution key
    // is (type, normalizedName), each variant becomes a separate node. Memory
    // that fragments on every retelling isn't memory.
    const knownList = knownEntities.length
      ? knownEntities.map((e) => `- ${e.type}: ${e.name}`).join('\n')
      : '(none yet)';

    const result = await generateObject({
      model: this.openRouterClient.provider(ai.extractionModel),
      schema: EXTRACTION_SCHEMA,
      // Extraction is a deterministic reading task, not a creative one, and the
      // default temperature made it one. Verified live: the SAME note, same
      // build, same prompt produced junk nodes ("friend", "bouza ice cream")
      // on one run and a correct empty graph on the next. Rules this specific
      // are only worth writing if the model actually follows them every time.
      temperature: 0,
      prompt: [
        'Extract a knowledge graph from this voice note, from the perspective of the person who recorded it.',
        '',
        'A node is a THING THE USER COULD LATER ASK ABOUT BY NAME. Apply that test to',
        'every candidate before you emit it. "Who is Fady Bakhos?" is a real question, so',
        'Fady is a node. "Tell me about friend" is not a question anyone asks, so "friend"',
        'is not a node. Extract meaning, not noun phrases — if you are copying a chunk of',
        'the sentence into a name, you are doing it wrong.',
        '',
        'Rules:',
        '- Use ONLY the provided entity types and relationship types. Pick the closest match; use Other/RELATED_TO if nothing fits.',
        '- Do NOT create a node for the speaker themselves ("I", "me", "you"). The whole graph is already theirs.',
        '- Name entities canonically and consistently: "Sarah Okonkwo", not "she" or "Sarah from Acme".',
        '- Give an entity its stable identity, not its current state: "pricing page", never "pricing page completion" or "blocked".',
        '- NEVER make a node out of a bare role or relationship word: "friend", "my boss",',
        '  "a colleague", "his mom". These describe a person rather than naming one.',
        '  If the person IS named, use the name. If they are NOT named, do not invent a',
        '  node for them — put the fact in the relation description instead.',
        '  "Charbel Baroud\'s mom" is a person, not a thing called "Charbel Baroud\'s mom".',
        '- NEVER make a node out of the wording of a reminder or task. From',
        '  "remind me at 6 about my friend\'s bday", the node is nothing — not',
        '  "friend bday", not "reminder". The reminder is handled separately.',
        '- A thing someone likes, ate, or mentioned in passing is only a node if it is a',
        '  durable, nameable thing worth recalling later — a specific game, product, place',
        '  or organisation. Generic objects ("ice cream", "a cookie", "the oven") are not',
        '  nodes; that someone likes them belongs in the relation description.',
        '- Prefer FEWER, better nodes. An empty nodes array is correct for a note that',
        '  names nothing durable. Do not pad the graph.',
        '- Do NOT create a TimeReference for a scheduling time — neither a clock time ("3:39", "8pm")',
        '  nor a duration ("in 2 minutes", "in an hour"). Those belong to the reminder, not the graph,',
        '  and produced junk nodes like "1 minute". Only use TimeReference for a durable, meaningful',
        '  date the note is ABOUT, e.g. a birthday or a deadline.',
        '',
        'Worked examples:',
        '  "remind me at 3:39 that my friend enjoys bouza ice cream"',
        '    -> nodes: []   (no one is named; "friend", "bouza ice cream" and the reminder wording are all non-nodes)',
        '  "Andrew Khoury loves Dota 2"',
        '    -> nodes: [Person: Andrew Khoury, Product: Dota 2]',
        '       relations: [Andrew Khoury -RELATED_TO-> Dota 2, description "loves playing it"]',
        '  "Fady\'s mom is in hospital"',
        '    -> nodes: [Person: Fady]',
        '       relations: []  ; the mother is unnamed — record it in Fady\'s description, not as a node',
        '',
        'SPELLING REFERENCE — names the user has used before:',
        knownList,
        '',
        'That list exists ONLY so you spell a recurring entity the same way twice. It is',
        'NOT a list of things worth extracting, and it is NOT a menu to pick from. Some',
        'entries in it are junk from earlier mistakes. An entry appearing there does not',
        'make it node-worthy — apply the test above to every candidate regardless. If the',
        'note does not genuinely name that entity, do not emit it just because it is listed.',
        '- Every relation\'s source and target MUST also appear in the nodes array, with the same type and name.',
        '',
        `Voice note: "${text}"`,
      ].join('\n'),
    });

    return result.object;
  }

  private async updateJobStatus(fileUuid: string, status: string, errorMsg?: string) {
    try {
      const transcript = await this.voiceRepository.findOne({ fields: { fileUuid } as any });
      if (transcript) {
        await this.voiceRepository.update(transcript.id, {
          status,
          summary: errorMsg ? `Error: ${errorMsg}` : null,
        });
      }
    } catch (err) {
      this.logger.error(`Failed to update job status in DB: ${err.message}`);
    }
  }
}
