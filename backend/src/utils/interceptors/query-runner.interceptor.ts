import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Logger,
} from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { from, lastValueFrom, Observable } from 'rxjs';
import { Request } from 'express';
import { safeRelease } from '../queryRunner/querry-runner-release-mechanism';
import {
  discardAfterCommit,
  flushAfterCommit,
} from '../queryRunner/after-commit';

interface RequestWithQueryRunner extends Request {
  queryRunner?: QueryRunner;
}

@Injectable()
export class QueryRunnerInterceptor implements NestInterceptor {
  private readonly logger = new Logger(QueryRunnerInterceptor.name);

  constructor(private readonly dataSource: DataSource) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(this.handleRequest(context, next));
  }

  private async handleRequest(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<RequestWithQueryRunner>();
    const requestLabel = this.getRequestLabel(request);

    if (!request) {
      return lastValueFrom(next.handle());
    }

    if (request.queryRunner) {
      this.logger.debug(
        `${requestLabel} - Reusing existing QueryRunner from parent context`,
      );
      return lastValueFrom(next.handle());
    }

    const queryRunner = this.dataSource.createQueryRunner();
    request.queryRunner = queryRunner;
    this.logger.debug(`${requestLabel} - Created QueryRunner instance`);

    await queryRunner.connect();
    await queryRunner.startTransaction();
    this.logger.debug(`${requestLabel} - Transaction started`);

    try {
      const result = await lastValueFrom(next.handle());
      await queryRunner.commitTransaction();
      this.logger.debug(`${requestLabel} - Transaction committed`);

      // Only now is the data durable and visible to other connections, so this
      // is the earliest safe point to enqueue jobs that will read it.
      await flushAfterCommit(queryRunner, this.logger);

      return result;
    } catch (error) {
      this.logger.error(`${requestLabel} - Error encountered`, error as Error);
      await this.safeRollback(queryRunner, requestLabel);
      throw error;
    } finally {
      // On rollback the referenced rows never existed; on a flush failure the
      // callbacks have already been drained. Either way nothing may linger.
      discardAfterCommit(queryRunner);
      await safeRelease(queryRunner);
      this.logger.debug(`${requestLabel} - QueryRunner released`);
      request.queryRunner = undefined;
    }
  }

  private async safeRollback(
    queryRunner: QueryRunner,
    requestLabel: string,
  ): Promise<void> {
    if (queryRunner.isReleased || !queryRunner.isTransactionActive) {
      return;
    }

    try {
      await queryRunner.rollbackTransaction();
      this.logger.debug(`${requestLabel} - Transaction rolled back`);
    } catch (rollbackError) {
      const errorTrace =
        rollbackError instanceof Error
          ? (rollbackError.stack ?? rollbackError.message)
          : String(rollbackError);
      this.logger.error('Failed to rollback transaction', errorTrace);
    }
  }

  private getRequestLabel(request?: Request): string {
    if (!request) {
      return '[unknown-request]';
    }

    const method = request.method ?? 'UNKNOWN';
    const url = request.originalUrl ?? request.url ?? '[unknown-url]';
    return `${method} ${url ?? '[unknown-url]'}`;
  }
}
