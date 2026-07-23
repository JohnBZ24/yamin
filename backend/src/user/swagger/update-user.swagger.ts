import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';

import { UpdateUserDto } from '../dto/update-user.dto';
import { UserResponseDto } from '../dto/user-response.dto';

export function ApiUpdateUser() {
  return applyDecorators(
    ApiOperation({ summary: 'Update current user' }),
    ApiBody({ type: UpdateUserDto }),
    ApiResponse({
      status: 200,
      description: 'User updated successfully',
      type: UserResponseDto,
    }),
    ApiResponse({ status: 404, description: 'User not found' }),
  );
}

export function ApiUpdateUserById() {
  return applyDecorators(
    ApiOperation({ summary: 'Update user by id' }),
    ApiParam({ name: 'id', type: Number, description: 'User ID' }),
    ApiBody({ type: UpdateUserDto }),
    ApiResponse({
      status: 200,
      description: 'User updated successfully',
      type: UserResponseDto,
    }),
    ApiResponse({ status: 404, description: 'User not found' }),
  );
}
