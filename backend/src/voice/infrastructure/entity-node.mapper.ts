import { EntityNode } from '../domain/entity-node';
import { EntityNodeEntity } from './entity-node.entity';

export class EntityNodeMapper {
  static toDomain(entity: EntityNodeEntity): EntityNode {
    const domain = new EntityNode();
    domain.id = entity.id;
    domain.userId = entity.userId;
    domain.type = entity.type;
    domain.name = entity.name;
    domain.normalizedName = entity.normalizedName;
    domain.description = entity.description;
    domain.mentionCount = entity.mentionCount;
    domain.lastMentionedAt = entity.lastMentionedAt;
    domain.createdAt = entity.createdAt;
    domain.updatedAt = entity.updatedAt;
    domain.deletedAt = entity.deletedAt;
    return domain;
  }

  static toPersistence(domain: EntityNode): EntityNodeEntity {
    const entity = new EntityNodeEntity();
    if (domain.id !== undefined) {
      entity.id = domain.id;
    }
    entity.userId = domain.userId;
    entity.type = domain.type;
    entity.name = domain.name;
    entity.normalizedName = domain.normalizedName;
    entity.description = domain.description;
    return entity;
  }
}
