import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, QueryRunner, Repository } from 'typeorm';

import { User } from '../domain/user';
import { UserEntity } from './user.entity';
import { NullableType } from '../../utils/types/nullable.type';
import {
  FilterUserDto,
  QueryUserDto,
  SortUserDto,
} from '../dto/query-user.dto';
import { IPaginationOptions } from '../../utils/types/pagination-options';
import { EntityCondition } from '../../utils/types/entity-condition.type';
import { UserMapper } from './user.mapper';
import { RelationsAndSelectsOptions } from '../../utils/types/relations-and-selects-options';
import { addRelationsAndSelects } from '../../utils/queryRunner/add-relations-and-selects';
import {
  userFindManyDefault,
  userFindOneDefault,
} from './relations-and-selects-options';
// repository is TypeORM's way to interact with a DB table
// every entity has its own repository
// gives you methods to query that tab
@Injectable()
export class UserRepository {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repository: Repository<UserEntity>,
  ) {}
  //queryRunner.manager is the only way to get a repository that is CONNECTED to the transaction:
  //manager acan access multiple tables

  private getRepository(queryRunner?: QueryRunner): Repository<UserEntity> {
    if (queryRunner) {
      return queryRunner.manager.getRepository(UserEntity);
    }

    return this.repository;
  }

  async create(
    data: Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
    queryRunner?: QueryRunner,
  ): Promise<User> {
    const repository = this.getRepository(queryRunner);

    const entity = repository.create(UserMapper.toPersistence(data as User));
    const saved = await repository.save(entity);
    return UserMapper.toDomain(saved);
  }

  async findManyWithPagination(
    //   {
    //   filterOptions,
    //   sortOptions,
    //   paginationOptions,
    //   queryRunner,
    //   relationsAndSelects = userFindManyDefault,
    // }: {
    //   filterOptions?: FilterUserDto | null;
    //   sortOptions?: SortUserDto[] | null;
    //   paginationOptions: IPaginationOptions;
    //   queryRunner?: QueryRunner;
    //   relationsAndSelects?: RelationsAndSelectsOptions;
    // }

    {
      query,
      queryRunner,
      relationsAndSelects = userFindManyDefault,
    }: {
      query: QueryUserDto;
      queryRunner?: QueryRunner;
      relationsAndSelects?: RelationsAndSelectsOptions;
    },
  ): Promise<{ data: User[]; totalCount: number }> {
    const repository = this.getRepository(queryRunner);
    let queryBuilder = repository.createQueryBuilder('user');

    // Apply dynamic selects and joins (MUST await!)
    queryBuilder = await addRelationsAndSelects(
      queryBuilder,
      relationsAndSelects,
    );

    // Apply filters
    if (query.filters?.name) {
      queryBuilder.andWhere(
        '(user.firstName ILIKE :name OR user.lastName ILIKE :name)',
        {
          name: `%${query.filters.name}%`,
        },
      );
    }

    if (query.filters?.email) {
      queryBuilder.andWhere('user.email ILIKE :email', {
        email: `%${query.filters.email}%`,
      });
    }

    // Apply sorting
    if (query.sort && query.sort.length > 0) {
      query.sort.forEach((sort) => {
        if (sort?.orderBy) {
          queryBuilder.addOrderBy(
            `user.${String(sort.orderBy)}`,
            (sort.order ?? 'ASC').toUpperCase() as 'ASC' | 'DESC',
          );
        }
      });
    } else {
      queryBuilder.orderBy('user.createdAt', 'DESC');
    }
    if (query.page && query.limit) {
      // Apply pagination
      const page = query.page;
      const limit = query.limit;
      queryBuilder.skip((page - 1) * limit).take(limit);
    }

    const [entities, totalCount] = await queryBuilder.getManyAndCount();

    return {
      data: entities.map((entity) => UserMapper.toDomain(entity)),
      totalCount,
    };
  }

  async findOne({
    fields,
    queryRunner,
    relationsAndSelects = userFindOneDefault,
  }: {
    fields: EntityCondition<User>;
    queryRunner?: QueryRunner;
    relationsAndSelects?: RelationsAndSelectsOptions;
  }): Promise<NullableType<User>> {
    const repository = this.getRepository(queryRunner);
    let queryBuilder = repository.createQueryBuilder('user');

    // Apply dynamic selects and joins (MUST await!)
    queryBuilder = await addRelationsAndSelects(
      queryBuilder,
      relationsAndSelects,
    );

    // Apply field filters
    if (fields.id) {
      queryBuilder.andWhere('user.id = :id', { id: fields.id });
    }

    if (fields.email) {
      queryBuilder.andWhere('user.email = :email', {
        email: fields.email,
      });
    }

    if (fields.phoneNumber) {
      queryBuilder.andWhere('user.phoneNumber = :phoneNumber', {
        phoneNumber: fields.phoneNumber,
      });
    }

    if (fields.firstName) {
      queryBuilder.andWhere('user.firstName = :firstName', {
        firstName: fields.firstName,
      });
    }

    if (fields.lastName) {
      queryBuilder.andWhere('user.lastName = :lastName', {
        lastName: fields.lastName,
      });
    }

    const entity = await queryBuilder.getOne();

    return entity ? UserMapper.toDomain(entity) : null;
  }

  async update(
    id: User['id'],
    payload: DeepPartial<User>,
    queryRunner?: QueryRunner,
  ): Promise<User | null> {
    const repository = this.getRepository(queryRunner);

    const entity = await repository.preload({ id, ...payload });

    if (!entity) {
      return null;
    }

    const saved = await repository.save(entity);
    return UserMapper.toDomain(saved);
  }

  async softDelete({
    id,
    queryRunner,
  }: {
    id: User['id'];
    queryRunner?: QueryRunner;
  }): Promise<void> {
    const repository = this.getRepository(queryRunner);
    await repository.softDelete(id);
  }
}
