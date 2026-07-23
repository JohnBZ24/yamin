import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { QueryRunner } from 'typeorm';

import { MemoryService } from './memory.service';
import { SearchMemoryDto } from './dto/search-memory.dto';
import { AskMemoryDto } from './dto/ask-memory.dto';
import { ClassifyIntentDto } from './dto/classify-intent.dto';
import { MergeEntitiesDto } from './dto/merge-entities.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../utils/decorators/getUser.decorator';
import { TransactionQueryRunner } from '../utils/decorators/transaction-query-runner.decorator';
import { QueryRunnerInterceptor } from '../utils/interceptors/query-runner.interceptor';

/**
 * Reading the memory back — the half of the product that didn't exist.
 *
 * Everything here is scoped to the authenticated user inside the SQL itself,
 * never by a filter applied afterwards. This is the most sensitive data in the
 * app; a missing WHERE clause here leaks one person's private life to another.
 */
@ApiTags('Memory')
@Controller({ path: 'memory', version: '1' })
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Semantic search across your voice notes' })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(QueryRunnerInterceptor)
  @Get('search')
  @HttpCode(HttpStatus.OK)
  async search(
    @Query() dto: SearchMemoryDto,
    @GetUser() userId: number,
    @TransactionQueryRunner() queryRunner: QueryRunner,
  ) {
    return this.memoryService.search(dto, userId, queryRunner);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Ask a question; answered only from your own memories, with sources',
  })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(QueryRunnerInterceptor)
  @Post('ask')
  @HttpCode(HttpStatus.OK)
  async ask(
    @Body() dto: AskMemoryDto,
    @GetUser() userId: number,
    @TransactionQueryRunner() queryRunner: QueryRunner,
  ) {
    return this.memoryService.ask(dto, userId, queryRunner);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Decide whether a message is a question to answer or a note to keep',
    description:
      'Lets one input box serve both purposes instead of making the user pick a mode first.',
  })
  @UseGuards(JwtAuthGuard)
  @Post('classify')
  @HttpCode(HttpStatus.OK)
  async classify(@Body() dto: ClassifyIntentDto) {
    return this.memoryService.classifyIntent(dto.text);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'The people, projects and places you talk about most' })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(QueryRunnerInterceptor)
  @Get('entities')
  @HttpCode(HttpStatus.OK)
  async entities(
    @GetUser() userId: number,
    @Query('q') q: string | undefined,
    @Query('limit') limit = 50,
    @TransactionQueryRunner() queryRunner: QueryRunner,
  ) {
    return q
      ? this.memoryService.findEntities(userId, q, Number(limit), queryRunner)
      : this.memoryService.listEntities(userId, Number(limit), queryRunner);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Everything you know about one entity' })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(QueryRunnerInterceptor)
  @Get('entities/:id')
  @HttpCode(HttpStatus.OK)
  async entity(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() userId: number,
    @TransactionQueryRunner() queryRunner: QueryRunner,
  ) {
    return this.memoryService.getEntity(userId, id, queryRunner);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Merge duplicate entities into this one (they are soft-deleted)',
  })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(QueryRunnerInterceptor)
  @Post('entities/:id/merge')
  @HttpCode(HttpStatus.OK)
  async merge(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MergeEntitiesDto,
    @GetUser() userId: number,
    @TransactionQueryRunner() queryRunner: QueryRunner,
  ) {
    return this.memoryService.mergeEntities(dto, id, userId, queryRunner);
  }
}
