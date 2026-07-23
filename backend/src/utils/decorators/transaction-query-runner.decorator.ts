import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';

interface RequestWithQueryRunner {
  readonly queryRunner?: QueryRunner;
}

export const TransactionQueryRunner = createParamDecorator(
  (_data: unknown, context: ExecutionContext): QueryRunner | undefined => {
    const request = context.switchToHttp().getRequest<RequestWithQueryRunner>();

    return request.queryRunner;
  },
);
