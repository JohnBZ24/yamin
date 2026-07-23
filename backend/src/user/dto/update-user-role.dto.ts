import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RoleEnum } from '../../utils/enums/roles.enum';

const roleOptionsDescription = Object.entries(RoleEnum)
  .filter(([, value]) => typeof value === 'number')
  .map(([key, value]) => `${key} (${value})`)
  .join(', ');

export class UpdateUserRoleDto {
  @ApiProperty({
    enum: RoleEnum,
    enumName: 'RoleEnum',
    example: RoleEnum.admin,
    description: `The new role to assign to the user. Available roles: ${roleOptionsDescription}.`,
  })
  @IsNotEmpty()
  @IsEnum(RoleEnum)
  role: RoleEnum;
}
