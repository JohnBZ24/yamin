import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { RelationsAndSelectsOptions } from '../types/relations-and-selects-options';
// import { RelationsAndSelectsOptions } from '../types/relations-and-selects-options';

// this function will take a config and applies it to the queryBuilder
export async function addRelationsAndSelects<T extends ObjectLiteral>(
  queryBuilder: SelectQueryBuilder<T>,

  config: Partial<RelationsAndSelectsOptions>,
): Promise<SelectQueryBuilder<T>> {
  if (config.select && config.select.length > 0) {
    queryBuilder.select(config.select);
  }

  if (config.joins && config.joins.length > 0) {
    config.joins.forEach((joinDef) => {
      const joinType = joinDef.joinType?.toLowerCase() || 'left';
      if (joinType === 'inner') {
        if (joinDef.condition) {
          queryBuilder.innerJoin(
            joinDef.propertyPath,
            joinDef.alias,
            joinDef.condition,
          );
        } else {
          queryBuilder.innerJoin(joinDef.propertyPath, joinDef.alias);
        }
      } else {
        if (joinDef.condition) {
          queryBuilder.leftJoin(
            joinDef.propertyPath,
            joinDef.alias,
            joinDef.condition,
          );
        } else {
          queryBuilder.leftJoin(joinDef.propertyPath, joinDef.alias);
        }
      }
    });
  }

  return queryBuilder;
}
