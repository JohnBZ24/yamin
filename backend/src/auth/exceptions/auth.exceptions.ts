import { HttpStatus } from '@nestjs/common';
import { BaseCustomException } from '../../utils/error/global-exceptions';

class AuthException extends BaseCustomException {
  constructor(
    errorCode: string,
    message: string,
    status: HttpStatus,
    details?: Record<string, unknown>,
  ) {
    super(errorCode, message, status, details);
  }
}

export class AuthIncorrectPassword extends AuthException {
  constructor(details?: Record<string, unknown>) {
    super(
      'AUTH_INCORRECT_PASSWORD',
      'The password provided is incorrect.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      details,
    );
  }
}

export class AuthUserNotFound extends AuthException {
  constructor(details?: Record<string, unknown>) {
    super(
      'AUTH_USER_NOT_FOUND',
      'User not found with the provided email.',
      HttpStatus.NOT_FOUND,
      details,
    );
  }
}

export class AuthInvalidRefreshToken extends AuthException {
  constructor(details?: Record<string, unknown>) {
    super(
      'AUTH_INVALID_REFRESH_TOKEN',
      'The provided refresh token is invalid.',
      HttpStatus.UNAUTHORIZED,
      details,
    );
  }
}
