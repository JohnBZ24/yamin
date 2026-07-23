import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

import { QueryUserDto } from '../dto/query-user.dto';
import { UserResponseDto } from '../dto/user-response.dto';

export function ApiFindAllUsers() {
  return applyDecorators(
    ApiOperation({ summary: 'List users with pagination' }),
    ApiResponse({
      status: 200,
      description: 'Users retrieved successfully',
      type: UserResponseDto,
      isArray: true,
    }),
  );
}
