import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

import { UserRepository } from './infrastructure/user.repository';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUserDto } from './dto/query-user.dto';
import { RoleEnum } from '../utils/enums/roles.enum';
import {
  UserEmailAlreadyExistsException,
  UserEmailNotProvidedException,
  UserNotFoundException,
} from './exceptions/user.exceptions';
import { User } from './domain/user';
import { InfinityPaginationWithTotalResultType } from '../utils/types/infinity-pagination-result.type';
import { infinityPaginationWithTotal } from '../utils/helpers';
import { QueryRunner } from 'typeorm';
import { RelationsAndSelectsOptions } from '../utils/types/relations-and-selects-options';
import { NullableType } from '../utils/types/nullable.type';

@Injectable()
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  async create({
    createUserDto,
    queryRunner,
  }: {
    createUserDto: CreateUserDto;
    queryRunner?: QueryRunner;
  }): Promise<User> {
    if (!createUserDto.email) {
      throw new UserEmailNotProvidedException({ createUserDto });
    }

    const existing = await this.userRepository.findOne({
      fields: { email: createUserDto.email },
      queryRunner,
    });

    if (existing) {
      throw new UserEmailAlreadyExistsException({
        email: createUserDto.email,
      });
    }

    const hashedPassword = await this.hashPassword(createUserDto.password);

    return this.userRepository.create(
      {
        ...createUserDto,
        password: hashedPassword,
        isEmailVerified: false,
      },
      queryRunner,
    );
  }

  async findManyWithPagination({
    query,
    queryRunner,
    relationsAndSelects,
  }: {
    query: QueryUserDto;
    queryRunner?: QueryRunner;
    relationsAndSelects?: RelationsAndSelectsOptions;
  }): Promise<{ data: User[]; totalCount: number }> {
    return this.userRepository.findManyWithPagination({
      query,
      queryRunner,
      relationsAndSelects,
    });
  }

  async findOne({
    id,
    queryRunner,
    relationsAndSelects,
  }: {
    id: number;
    queryRunner?: QueryRunner;
    relationsAndSelects?: RelationsAndSelectsOptions;
  }): Promise<User | null> {
    const user = await this.userRepository.findOne({
      fields: { id },
      queryRunner,
      relationsAndSelects,
    });

    return user;
  }

  async findOneByEmail({
    email,
    queryRunner,
    relationsAndSelects,
  }: {
    email: string;
    queryRunner?: QueryRunner;
    relationsAndSelects?: RelationsAndSelectsOptions;
  }): Promise<User | null> {
    return this.userRepository.findOne({
      fields: { email },
      queryRunner,
      relationsAndSelects,
    });
  }

  async update({
    id,
    updateUserDto,
    queryRunner,
  }: {
    id: number;
    updateUserDto: UpdateUserDto;
    queryRunner?: QueryRunner;
  }): Promise<User> {
    const user = await this.findOne({ id, queryRunner });

    if (!user) {
      throw new UserNotFoundException({ id });
    }

    // find if email already exists (or make the email unique true on DB level )
    const userWithSameEmail = await this.userRepository.findOne({
      fields: { email: updateUserDto.email },
      queryRunner,
    });

    if (userWithSameEmail && userWithSameEmail.id !== id) {
      throw new UserEmailAlreadyExistsException({
        email: updateUserDto.email,
      });
    }

    // Hash password if provided
    if (updateUserDto.password) {
      updateUserDto.password = await this.hashPassword(updateUserDto.password);
    }

    const updated = await this.userRepository.update(id, updateUserDto);
    if (!updated) {
      throw new UserNotFoundException({ id });
    }

    return updated;
  }

  async softDelete({
    id,
    queryRunner,
  }: {
    id: number;
    queryRunner?: QueryRunner;
  }): Promise<void> {
    const existingUser = await this.userRepository.findOne({
      fields: { id },
      queryRunner,
    });
    if (!existingUser) {
      throw new UserNotFoundException({ id });
    }

    await this.userRepository.softDelete({ id, queryRunner });
  }

  async updateRole({
    id,
    role,
    queryRunner,
  }: {
    id: number;
    role: RoleEnum;
    queryRunner?: QueryRunner;
  }): Promise<User> {
    const user = await this.findOne({ id, queryRunner });

    if (!user) {
      throw new UserNotFoundException({ id });
    }

    const updated = await this.userRepository.update(id, { role }, queryRunner);
    if (!updated) {
      throw new UserNotFoundException({ id });
    }

    return updated;
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt();
    return bcrypt.hash(password, salt);
  }
}
