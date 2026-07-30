import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryRunner, Repository } from 'typeorm';

import { ChatMessageEntity } from './chat-message.entity';

export type ConversationSummary = {
  conversationUuid: string;
  title: string;
  turnCount: number;
  lastAt: Date;
};

@Injectable()
export class ChatMessageRepository {
  constructor(
    @InjectRepository(ChatMessageEntity)
    private readonly messages: Repository<ChatMessageEntity>,
  ) {}

  private repo(queryRunner?: QueryRunner): Repository<ChatMessageEntity> {
    return queryRunner
      ? queryRunner.manager.getRepository(ChatMessageEntity)
      : this.messages;
  }

  async createTurn(
    turn: Pick<
      ChatMessageEntity,
      'userId' | 'conversationUuid' | 'question' | 'answer' | 'sources'
    >,
    queryRunner?: QueryRunner,
  ): Promise<ChatMessageEntity> {
    const repository = this.repo(queryRunner);
    return repository.save(repository.create(turn));
  }

  /**
   * One row per conversation, newest activity first. The title is the FIRST
   * question of the conversation — that's what the user typed to start it,
   * which is how they'll recognise it in a list.
   */
  async listConversations(
    { userId, limit }: { userId: number; limit: number },
    queryRunner?: QueryRunner,
  ): Promise<ConversationSummary[]> {
    return this.repo(queryRunner).query(
      `SELECT "conversationUuid",
              (ARRAY_AGG("question" ORDER BY "createdAt" ASC))[1] AS "title",
              COUNT(*)::int AS "turnCount",
              MAX("createdAt") AS "lastAt"
         FROM "chat_message"
        WHERE "userId" = $1
        GROUP BY "conversationUuid"
        ORDER BY MAX("createdAt") DESC
        LIMIT $2`,
      [userId, limit],
    );
  }

  /**
   * Delete a whole conversation, scoped to its owner.
   *
   * `userId` is part of the WHERE clause rather than checked beforehand: a uuid
   * belonging to someone else must delete nothing, and a separate ownership
   * lookup is a race — this way the database enforces it in the same statement.
   * Returns how many turns went, so the caller can 404 a uuid that matched
   * nothing instead of reporting a successful delete of nothing.
   */
  async deleteConversation(
    { userId, conversationUuid }: { userId: number; conversationUuid: string },
    queryRunner?: QueryRunner,
  ): Promise<number> {
    const result = await this.repo(queryRunner).delete({
      userId,
      conversationUuid,
    });
    return result.affected ?? 0;
  }

  /** All turns of one conversation, oldest first — render order. */
  async listTurns(
    { userId, conversationUuid }: { userId: number; conversationUuid: string },
    queryRunner?: QueryRunner,
  ): Promise<ChatMessageEntity[]> {
    return this.repo(queryRunner).find({
      where: { userId, conversationUuid },
      order: { createdAt: 'ASC' },
    });
  }
}
