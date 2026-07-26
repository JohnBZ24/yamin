import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Not, QueryRunner, Repository } from 'typeorm';
import { VoiceTranscript } from '../domain/voice-transcript';
import { VoiceTranscriptEntity } from './voice-transcript.entity';
import { NullableType } from '../../utils/types/nullable.type';
import { EntityCondition } from '../../utils/types/entity-condition.type';
import { VoiceTranscriptMapper } from './voice-transcript.mapper';
import { IPaginationOptions } from '../../utils/types/pagination-options';

@Injectable()
export class VoiceTranscriptRepository {
  constructor(
    @InjectRepository(VoiceTranscriptEntity)
    private readonly repository: Repository<VoiceTranscriptEntity>,
  ) {}

  private getRepository(
    queryRunner?: QueryRunner,
  ): Repository<VoiceTranscriptEntity> {
    if (queryRunner) {
      return queryRunner.manager.getRepository(VoiceTranscriptEntity);
    }
    return this.repository;
  }

  async create(
    data: Omit<VoiceTranscript, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
    queryRunner?: QueryRunner,
  ): Promise<VoiceTranscript> {
    const repository = this.getRepository(queryRunner);
    const entity = repository.create(
      VoiceTranscriptMapper.toPersistence(data as VoiceTranscript),
    );
    const saved = await repository.save(entity);
    return VoiceTranscriptMapper.toDomain(saved);
  }

  async findOne({
    fields,
    queryRunner,
  }: {
    fields: EntityCondition<VoiceTranscript>;
    queryRunner?: QueryRunner;
  }): Promise<NullableType<VoiceTranscript>> {
    const repository = this.getRepository(queryRunner);
    const entity = await repository.findOne({ where: fields as any });
    return entity ? VoiceTranscriptMapper.toDomain(entity) : null;
  }

  async update(
    id: VoiceTranscript['id'],
    payload: DeepPartial<VoiceTranscript>,
    queryRunner?: QueryRunner,
  ): Promise<VoiceTranscript | null> {
    const repository = this.getRepository(queryRunner);
    const entity = await repository.preload({ id, ...payload } as any);
    if (!entity) return null;
    const saved = await repository.save(entity);
    return VoiceTranscriptMapper.toDomain(saved);
  }

  /**
   * Soft-delete a note and detach it from the memory graph.
   *
   * The mention rows must go with the note: findEntitiesForTranscripts and the
   * entity mention counters are raw SQL that don't respect TypeORM's
   * soft-delete, so leaving them would keep a "deleted" note visible as
   * provenance. Affected entities get their mentionCount recomputed from the
   * join table (same approach as mergeEntities — summing double-counts).
   */
  async softDeleteWithMentions(
    id: VoiceTranscript['id'],
    queryRunner?: QueryRunner,
  ): Promise<void> {
    const repository = this.getRepository(queryRunner);

    const result = await repository.query(
      `DELETE FROM "node_mention" WHERE "voiceTranscriptId" = $1 RETURNING "nodeId"`,
      [id],
    );
    // TypeORM's .query() shape differs by statement type (see mergeEntities).
    const rows: Array<{ nodeId: number }> = Array.isArray(result?.[0])
      ? result[0]
      : (result ?? []);
    const nodeIds = [...new Set(rows.map((row) => row.nodeId))];

    if (nodeIds.length > 0) {
      await repository.query(
        `UPDATE "entity_node"
            SET "mentionCount" = (
                  SELECT count(*) FROM "node_mention"
                   WHERE "nodeId" = "entity_node"."id"
                ),
                "updatedAt" = now()
          WHERE "id" = ANY($1::int[])`,
        [nodeIds],
      );
    }

    await repository.softDelete(id);
  }

  /**
   * The user's last few notes, newest first — CONTEXT for the extraction
   * worker, which otherwise reads every note in total isolation. "he has an
   * operation Tuesday" is unresolvable on its own; shown the note recorded a
   * minute earlier ("my friend Andrew Khoury…"), the extractor can resolve
   * the pronoun to the right person. Excludes the note being processed.
   */
  async findRecentForContext({
    userId,
    excludeFileUuid,
    limit = 6,
    queryRunner,
  }: {
    userId: number;
    excludeFileUuid: string;
    limit?: number;
    queryRunner?: QueryRunner;
  }): Promise<
    Array<{ rawText: string | null; summary: string | null; createdAt: Date }>
  > {
    const repository = this.getRepository(queryRunner);
    const entities = await repository.find({
      where: {
        userId,
        status: Not('awaiting_upload'),
        fileUuid: Not(excludeFileUuid),
      },
      order: { createdAt: 'DESC' },
      take: limit,
      select: ['rawText', 'summary', 'createdAt'],
    });
    return entities.map((entity) => ({
      rawText: entity.rawText,
      summary: entity.summary,
      createdAt: entity.createdAt,
    }));
  }

  async findManyWithPagination({
    userId,
    paginationOptions,
    queryRunner,
  }: {
    userId: number;
    paginationOptions: IPaginationOptions;
    queryRunner?: QueryRunner;
  }): Promise<{ data: VoiceTranscript[]; totalCount: number }> {
    const repository = this.getRepository(queryRunner);
    // 'awaiting_upload' rows are presign placeholders; a recording the user
    // abandoned before submitting must not surface as a phantom note.
    const [entities, totalCount] = await repository.findAndCount({
      where: { userId, status: Not('awaiting_upload') },
      order: { createdAt: 'DESC' },
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
    });
    return {
      data: entities.map((entity) => VoiceTranscriptMapper.toDomain(entity)),
      totalCount,
    };
  }
}
