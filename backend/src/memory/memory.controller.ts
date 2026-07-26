import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { QueryRunner } from 'typeorm';

import { MemoryService } from './memory.service';
import { SearchMemoryDto } from './dto/search-memory.dto';
import { AskMemoryDto } from './dto/ask-memory.dto';
import { ConverseDto } from './dto/converse.dto';
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
  private readonly logger = new Logger(MemoryController.name);

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
    summary:
      'Ask a question; answered only from your own memories, with sources',
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
    summary:
      'Route a message: a question to answer (ask), a note to keep (remember), or something to just reply to (chitchat)',
    description:
      'Lets one input box serve all three purposes instead of making the user pick a mode first.',
  })
  @UseGuards(JwtAuthGuard)
  @Post('classify')
  @HttpCode(HttpStatus.OK)
  async classify(@Body() dto: ClassifyIntentDto) {
    return this.memoryService.classifyIntent(dto.text);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Reply to a message that is neither a memory nor a question about your notes',
    description:
      'Greetings, "what can you do?", and general advice. Answers from the model\'s own ' +
      'understanding and returns no sources, which is how the client labels it as general ' +
      'rather than drawn from your memories. Separate from /ask on purpose: /ask embeds the ' +
      'message and, finding no match, loads recent private notes into the prompt — pointless ' +
      'and wrong for "hey".',
  })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(QueryRunnerInterceptor)
  @Post('reply')
  @HttpCode(HttpStatus.OK)
  async reply(
    @Body() dto: ConverseDto,
    @GetUser() userId: number,
    @TransactionQueryRunner() queryRunner: QueryRunner,
  ) {
    return this.memoryService.reply(dto, userId, queryRunner);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'The people, projects and places you talk about most',
  })
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
  @ApiOperation({
    summary:
      'Talk to Yamin: questions get answered from memory, information gets remembered (and reminders scheduled), small talk gets a reply',
  })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(QueryRunnerInterceptor)
  @Post('converse')
  @HttpCode(HttpStatus.OK)
  async converse(
    @Body() dto: ConverseDto,
    @GetUser() userId: number,
    @TransactionQueryRunner() queryRunner: QueryRunner,
  ) {
    return this.memoryService.converse(dto, userId, queryRunner);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'converse, streamed: the reply arrives as Markdown text chunks while it is generated. Metadata rides the X-Conversation-Uuid / X-Kind / X-Sources response headers.',
  })
  @UseGuards(JwtAuthGuard)
  // Deliberately NO QueryRunnerInterceptor: it wraps the request in a
  // transaction that commits when the handler returns, but a stream keeps
  // writing long after that. The writes here (chat turns, queue submit) are
  // each atomic on their own.
  @Post('converse/stream')
  async converseStream(
    @Body() dto: ConverseDto,
    @GetUser() userId: number,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    // Tells nginx not to buffer this response — without it the "stream"
    // reaches the browser as one lump whenever the proxy decides to flush.
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      await this.memoryService.converseStream(dto, userId, {
        meta: (m) => {
          res.setHeader('X-Conversation-Uuid', m.conversationUuid);
          res.setHeader('X-Kind', m.kind);
          // Headers are ASCII-only; summaries are not.
          res.setHeader(
            'X-Sources',
            encodeURIComponent(JSON.stringify(m.sources)),
          );
          res.flushHeaders();
        },
        write: (chunk) => {
          res.write(chunk);
        },
      });
    } catch (error) {
      // Mid-stream there is no status code left to send — the most honest
      // thing remaining is a visible line instead of a silently dead bubble.
      this.logger.error(
        `converse/stream failed for user ${userId}: ${(error as Error).message}`,
      );
      res.write('\n\n_Sorry — something went wrong generating this reply._');
    }
    res.end();
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Your past chats with Yamin, newest first' })
  @UseGuards(JwtAuthGuard)
  @Get('chats')
  @HttpCode(HttpStatus.OK)
  async chats(@GetUser() userId: number, @Query('limit') limit = 30) {
    return this.memoryService.listChats(userId, Number(limit));
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Every turn of one conversation, with its cited voice notes',
  })
  @UseGuards(JwtAuthGuard)
  @Get('chats/:uuid')
  @HttpCode(HttpStatus.OK)
  async chat(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @GetUser() userId: number,
  ) {
    return this.memoryService.getChat(userId, uuid);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'The knowledge graph: top entities plus the relations among them',
  })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(QueryRunnerInterceptor)
  @Get('graph')
  @HttpCode(HttpStatus.OK)
  async graph(
    @GetUser() userId: number,
    @Query('limit') limit = 60,
    @TransactionQueryRunner() queryRunner: QueryRunner,
  ) {
    return this.memoryService.getGraph(userId, Number(limit), queryRunner);
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
