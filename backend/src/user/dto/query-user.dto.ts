import { Transform, Type, plainToInstance } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { User } from '../domain/user';

export class FilterUserDto {
  @ApiPropertyOptional({
    description: 'Search term matching first or last name',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Filter by email address' })
  @IsOptional()
  @IsString()
  email?: string;
}

export class SortUserDto {
  @ApiPropertyOptional({ example: 'createdAt' })
  @IsString()
  orderBy?: keyof User;

  @ApiPropertyOptional({ example: 'ASC', enum: ['ASC', 'DESC'] })
  @IsString()
  order?: 'ASC' | 'DESC';
}

export class QueryUserDto {
  @ApiPropertyOptional()
  @Transform(({ value }) => (value ? Number(value) : 1))
  @IsNumber()
  @IsOptional()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional()
  @Transform(({ value }) => (value ? Number(value) : 10))
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(50)
  limit: number = 10;

  @ApiPropertyOptional({
    type: String,
    description: 'JSON stringified filters',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value ? plainToInstance(FilterUserDto, JSON.parse(value)) : undefined,
  )
  @ValidateNested()
  @Type(() => FilterUserDto)
  filters?: FilterUserDto | null;

  @ApiPropertyOptional({ type: String, description: 'JSON stringified sort' })
  @IsOptional()
  @Transform(({ value }) =>
    value ? plainToInstance(SortUserDto, JSON.parse(value)) : undefined,
  )
  @ValidateNested({ each: true })
  @Type(() => SortUserDto)
  @IsArray()
  sort?: SortUserDto[] | null;
}
