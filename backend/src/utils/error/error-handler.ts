import { HttpException, HttpStatus } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import {
  DatabaseException,
  GenericServiceException,
} from './global-exceptions';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

const logger = new Logger('ErrorHandler'); // Create a logger for this module
const configService = new ConfigService();
//never means always throws never returns different than void because void ends normaally here it thwors
export function handleError(
  error: any,
  errorCode: string,
  message: string,
): never {
  if (error instanceof HttpException) {
    throw error;
  } else if (error instanceof QueryFailedError) {
    // Handle TypeORM QueryFailedError
    const dbMessage = error.message;
    throw new DatabaseException(configService, errorCode, dbMessage, 400, {
      query: error.query,
      parameters: error.parameters,
      name: error.name,
    });
  } else {
    // Handle all other unexpected errors
    logger.error(`Unexpected error (${errorCode}):`, error);
    throw new GenericServiceException(
      configService,
      errorCode,
      message,
      HttpStatus.INTERNAL_SERVER_ERROR,
      { originalError: error.message },
    );
  }
}
