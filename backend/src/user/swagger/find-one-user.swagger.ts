import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';

import { UserResponseDto } from '../dto/user-response.dto';

export function ApiFindOneUser() {
  return applyDecorators(
    ApiOperation({ summary: 'Get current user' }),
    ApiResponse({
      status: 200,
      description: 'User retrieved successfully',
      type: UserResponseDto,
    }),
    ApiResponse({ status: 404, description: 'User not found' }),
  );
}

export function ApiFindOneUserById() {
  return applyDecorators(
    ApiOperation({ summary: 'Get user by id' }),
    ApiParam({ name: 'id', type: Number, description: 'User ID' }),
    ApiResponse({
      status: 200,
      description: 'User retrieved successfully',
      type: UserResponseDto,
    }),
    ApiResponse({ status: 404, description: 'User not found' }),
  );
}
