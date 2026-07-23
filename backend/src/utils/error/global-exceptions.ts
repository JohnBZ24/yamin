import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigHelper } from './errorConfig';
export class BaseCustomException extends HttpException {
  constructor(
    public readonly errorCode: string,
    message: string,
    status: HttpStatus,
    details?: Record<string, any>,
  ) {
    // Access the configuration helper
    const config = ConfigHelper.getInstance();
    const showDetails = config.getShowErrorDetails();

    // Call super() first with minimal or empty details
    super({ statusCode: status, errorCode, message, details: {} }, status);

    // Now that super() is called, we can safely use this.constructor
    const error = new Error();
    Error.captureStackTrace(error, this.constructor);
    const stackLines = error.stack ? error.stack.split('\n') : [];

    // Find the first stack line that doesn't originate from your exceptions files
    const callerInfo = { filePath: 'unknown', lineNumber: 'unknown' };
    const callerLine = stackLines.find(
      (line) => !line.includes('exceptions') && line.includes('.ts:'),
    );

    if (callerLine) {
      const matched =
        callerLine.match(/\((.*):(\d+):(\d+)\)/) ||
        callerLine.match(/at\s+(.*):(\d+):(\d+)/);
      if (matched) {
        callerInfo.filePath = matched[1];
        callerInfo.lineNumber = matched[2];
      }
    }

    const enrichedDetails = {
      ...details,
      filePath: callerInfo.filePath,
      lineNumber: callerInfo.lineNumber,
    };

    if (showDetails) {
      // Update the response object now that we have the file and line info
      // HttpException stores its response in this.response. It's protected, but we can still cast and modify it.
      (this as any).response = {
        statusCode: status,
        errorCode,
        message,
        details: enrichedDetails,
      };
    } else {
      // Update the response object now that we have the file and line info
      // HttpException stores its response in this.response. It's protected, but we can still cast and modify it.
      (this as any).response = {
        statusCode: status,
        errorCode,
        message,
      };
    }
  }
}

// exception thrown for database-related errors
export class DatabaseException extends HttpException {
  constructor(
    configService: ConfigService,
    public readonly errorCode: string,
    message: string,
    status: HttpStatus = 400,
    public readonly details?: Record<string, any>,
  ) {
    const showDetails = configService.get<string>('SHOW_ERROR_DETAILS');
    const responseBody = {
      statusCode: status,
      errorCode,
      message,
    };

    if (showDetails == 'true') {
      responseBody['details'] = details;
    }

    super(responseBody, status);
  }
}

// generic exception for unexpected service-related errors
export class GenericServiceException extends HttpException {
  constructor(
    configService: ConfigService,
    public readonly errorCode: string,
    message: string,
    status: HttpStatus = 400,
    public readonly details?: Record<string, any>,
  ) {
    const showDetails = configService.get<string>('SHOW_ERROR_DETAILS');
    const responseBody = {
      statusCode: status,
      errorCode,
      message,
    };

    if (showDetails == 'true') {
      responseBody['details'] = details;
    }

    super(responseBody, status);
  }
}
