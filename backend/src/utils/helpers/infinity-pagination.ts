import { IPaginationOptions } from '../types/pagination-options';
import {
  InfinityPaginationResultType,
  InfinityPaginationWithtopThreeTotalAndResultType,
  InfinityPaginationWithTotalResultType,
} from '../types/infinity-pagination-result.type';

export const infinityPagination = <T>(
  data: T[],
  options: IPaginationOptions,
): InfinityPaginationResultType<T> => ({
  data,
  hasNextPage: data.length === options.limit,
});

export const infinityPaginationWithTotal = <T>(
  data: T[],
  totalCount: number,
  options: IPaginationOptions,
): InfinityPaginationWithTotalResultType<T> => ({
  data,
  hasNextPage: data.length === options.limit,
  totalCount,
});

export const infinityPaginationWithTopThreeAndTotal = <T>(
  data: T[],
  topThree: T[],
  totalCount: number,
  options: IPaginationOptions,
): InfinityPaginationWithtopThreeTotalAndResultType<T> => ({
  data,
  topThree,
  hasNextPage: data.length === options.limit,
  totalCount,
});
