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

/**
 * One deliberately vague error for EVERY login failure — unknown email, empty
 * password column, wrong password. The previous pair (AUTH_USER_NOT_FOUND 404
 * vs AUTH_INCORRECT_PASSWORD 422) told an attacker which emails have accounts:
 * probe the login form with a list of addresses and the status code alone
 * separates registered from not. Same reason this never carries `details` —
 * the old 404 echoed the submitted email back.
 */
export class AuthInvalidCredentials extends AuthException {
  constructor() {
    super(
      'AUTH_INVALID_CREDENTIALS',
      'Invalid email or password.',
      HttpStatus.UNAUTHORIZED,
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
