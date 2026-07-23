import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';

import { UpdateUserRoleDto } from '../dto/update-user-role.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { RoleEnum } from '../../utils/enums/roles.enum';

const roleEntries = Object.entries(RoleEnum).filter(
  ([, value]) => typeof value === 'number',
);
const roleValues = roleEntries.map(([, value]) => value);
const roleNames = roleEntries.map(([key]) => key);
const roleCollection = roleEntries
  .map(([key, value]) => `${key} (${value})`)
  .join(', ');
const roleSchema = {
  type: 'integer',
  enum: roleValues,
  description: `The new role to assign to the user. Available roles: ${roleCollection}.`,
  example: RoleEnum.admin,
  'x-enumNames': roleNames,
};

export function ApiUpdateUserRole() {
  return applyDecorators(
    ApiOperation({
      summary: 'Update user role (Super Admin only)',
      description:
        'Only super admins can update the role of any user. Available roles: ' +
        roleCollection +
        '.',
    }),
    ApiParam({ name: 'id', required: true, type: Number }),
    ApiBody({
      schema: {
        type: 'object',
        required: ['role'],
        properties: {
          role: roleSchema,
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: 'User role updated successfully',
      type: UserResponseDto,
    }),
    ApiResponse({
      status: 403,
      description: 'Forbidden - Super Admin access required',
    }),
    ApiResponse({ status: 404, description: 'User not found' }),
  );
}
