import { HttpStatus } from '@nestjs/common';

import { BaseCustomException } from '../../utils/error/global-exceptions';

class UserException extends BaseCustomException {
  constructor(
    errorCode: string,
    message: string,
    status: HttpStatus,
    details?: Record<string, unknown>,
  ) {
    super(errorCode, message, status, details);
  }
}

export class UserEmailAlreadyExistsException extends UserException {
  constructor(details?: Record<string, unknown>) {
    super(
      'USER_EMAIL_ALREADY_EXISTS',
      'The email provided is already in use.',
      HttpStatus.CONFLICT,
      details,
    );
  }
}

export class UserNotFoundException extends UserException {
  constructor(details?: Record<string, unknown>) {
    super(
      'USER_NOT_FOUND',
      'The requested user could not be found.',
      HttpStatus.NOT_FOUND,
      details,
    );
  }
}

export class UserEmailNotProvidedException extends UserException {
  constructor(details?: Record<string, unknown>) {
    super(
      'USER_EMAIL_NOT_PROVIDED',
      'user email not provided in service function.',
      HttpStatus.NOT_FOUND,
      details,
    );
  }
}
