import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { QueryRunner } from 'typeorm';

import { VoiceService } from './voice.service';
import { CreateVoiceProcessingDto } from './dto/create-voice-processing.dto';
import { RequestPresignedUrlDto } from './dto/request-presigned-url.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../utils/decorators/getUser.decorator';
import { TransactionQueryRunner } from '../utils/decorators/transaction-query-runner.decorator';
import { QueryRunnerInterceptor } from '../utils/interceptors/query-runner.interceptor';
import { VoiceTranscript } from './domain/voice-transcript';

@ApiTags('Voice')
@Controller({ path: 'voice', version: '1' })
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('presigned-url')
  @HttpCode(HttpStatus.OK)
  async getPresignedUrl(
    @Body() dto: RequestPresignedUrlDto,
    @GetUser() userId: number,
  ) {
    return this.voiceService.generatePresignedUrl(dto, userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('transcribe')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async transcribe(@UploadedFile() file: Express.Multer.File) {
    return this.voiceService.transcribeAudio(file);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(QueryRunnerInterceptor)
  @Post('processing')
  @HttpCode(HttpStatus.ACCEPTED)
  async startProcessing(
    @Body() dto: CreateVoiceProcessingDto,
    @GetUser() userId: number,
    @TransactionQueryRunner() queryRunner: QueryRunner,
  ): Promise<VoiceTranscript> {
    return this.voiceService.submitToQueue(dto, userId, queryRunner);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(QueryRunnerInterceptor)
  @Delete(':fileUuid')
  @HttpCode(HttpStatus.OK)
  async deleteNote(
    @Param('fileUuid', ParseUUIDPipe) fileUuid: string,
    @GetUser() userId: number,
    @TransactionQueryRunner() queryRunner: QueryRunner,
  ): Promise<{ fileUuid: string }> {
    return this.voiceService.deleteNote(fileUuid, userId, queryRunner);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(QueryRunnerInterceptor)
  @Get('history')
  @HttpCode(HttpStatus.OK)
  async getHistory(
    @GetUser() userId: number,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @TransactionQueryRunner() queryRunner: QueryRunner,
  ) {
    return this.voiceService.getUserHistory(userId, Number(page), Number(limit), queryRunner);
  }
}
