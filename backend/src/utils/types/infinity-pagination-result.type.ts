export type InfinityPaginationResultType<T> = Readonly<{
  data: T[];
  hasNextPage: boolean;
}>;

export type InfinityPaginationWithTotalResultType<T> = Readonly<{
  data: T[];
  hasNextPage: boolean;
  totalCount: number;
}>;

export type InfinityPaginationWithtopThreeTotalAndResultType<T> = Readonly<{
  data: T[];
  topThree: T[];
  hasNextPage: boolean;
  totalCount: number;
}>;
