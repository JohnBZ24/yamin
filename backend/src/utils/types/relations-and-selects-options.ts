export interface JoinDefinition {
  propertyPath: string; // e.g. 'proposal.organization'
  alias: string; // e.g. 'organization'
  joinType?: 'left' | 'inner';
  condition?: string; // e.g. 'EXISTS (SELECT 1 FROM ...)'
}

export interface RelationsAndSelectsOptions {
  select: string[];
  joins: JoinDefinition[];
}

export interface ISelectOptionsMap {
  [key: string]: Partial<RelationsAndSelectsOptions>;
}
