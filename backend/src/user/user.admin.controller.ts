import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { QueryUserDto } from './dto/query-user.dto';
import { ApiFindAllUsers } from './swagger/find-all-users.swagger';
import { ApiFindOneUserById } from './swagger/find-one-user.swagger';
import { ApiUpdateUserById } from './swagger/update-user.swagger';
import { ApiUpdateUserRole } from './swagger/update-user-role.swagger';
import { ApiDeleteUserById } from './swagger/delete-user.swagger';
import { InfinityPaginationWithTotalResultType } from '../utils/types/infinity-pagination-result.type';
import { infinityPaginationWithTotal } from '../utils/helpers';
import { User } from './domain/user';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleEnum } from '../utils/enums/roles.enum';
import { UserNotFoundException } from './exceptions/user.exceptions';
import { TransactionQueryRunner } from '../utils/decorators/transaction-query-runner.decorator';
import { QueryRunnerInterceptor } from '../utils/interceptors/query-runner.interceptor';
import type { QueryRunner } from 'typeorm';

@UseInterceptors(QueryRunnerInterceptor)
@ApiTags('User Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleEnum.superAdmin)
@Controller({ path: 'user-admin', version: '1' })
export class UserAdminController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiFindAllUsers()
  @Roles(RoleEnum.admin)
  async findAll(
    @Query() query: QueryUserDto,
    @TransactionQueryRunner() queryRunner: QueryRunner,
  ): Promise<InfinityPaginationWithTotalResultType<User>> {
    const { data, totalCount } = await this.userService.findManyWithPagination({
      query,
      queryRunner,
    });

    return infinityPaginationWithTotal(data, totalCount, {
      page: query.page,
      limit: query.limit,
    });
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(RoleEnum.admin)
  @ApiFindOneUserById()
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @TransactionQueryRunner() queryRunner: QueryRunner,
  ): Promise<User> {
    const user = await this.userService.findOne({ id, queryRunner });

    if (!user) {
      throw new UserNotFoundException({ id });
    }

    return user;
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiUpdateUserById()
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
    @TransactionQueryRunner() queryRunner: QueryRunner,
  ): Promise<User> {
    return this.userService.update({ id, updateUserDto, queryRunner });
  }

  @Patch(':id/role')
  @HttpCode(HttpStatus.OK)
  @ApiUpdateUserRole()
  async updateRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserRoleDto: UpdateUserRoleDto,
    @TransactionQueryRunner() queryRunner: QueryRunner,
  ): Promise<User> {
    return this.userService.updateRole({
      id,
      role: updateUserRoleDto.role,
      queryRunner,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDeleteUserById()
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @TransactionQueryRunner() queryRunner: QueryRunner,
  ): Promise<void> {
    await this.userService.softDelete({ id, queryRunner });
  }
}
