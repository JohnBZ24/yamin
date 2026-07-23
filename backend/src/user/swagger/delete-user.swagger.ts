import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';

export function ApiDeleteUser() {
  return applyDecorators(
    ApiOperation({ summary: 'Delete current user' }),
    ApiResponse({ status: 204, description: 'User deleted successfully' }),
    ApiResponse({ status: 404, description: 'User not found' }),
  );
}

export function ApiDeleteUserById() {
  return applyDecorators(
    ApiOperation({ summary: 'Delete user by id' }),
    ApiParam({ name: 'id', type: Number, description: 'User ID' }),
    ApiResponse({ status: 204, description: 'User deleted successfully' }),
    ApiResponse({ status: 404, description: 'User not found' }),
  );
}
