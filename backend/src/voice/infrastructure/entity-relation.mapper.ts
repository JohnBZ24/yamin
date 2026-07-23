import { EntityRelation } from '../domain/entity-relation';
import { EntityRelationEntity } from './entity-relation.entity';

export class EntityRelationMapper {
  static toDomain(entity: EntityRelationEntity): EntityRelation {
    const domain = new EntityRelation();
    domain.id = entity.id;
    domain.userId = entity.userId;
    domain.sourceNodeId = entity.sourceNodeId;
    domain.targetNodeId = entity.targetNodeId;
    domain.type = entity.type;
    domain.description = entity.description;
    domain.voiceTranscriptId = entity.voiceTranscriptId;
    domain.mentionCount = entity.mentionCount;
    domain.lastMentionedAt = entity.lastMentionedAt;
    domain.createdAt = entity.createdAt;
    domain.updatedAt = entity.updatedAt;
    domain.deletedAt = entity.deletedAt;
    return domain;
  }

  static toPersistence(domain: EntityRelation): EntityRelationEntity {
    const entity = new EntityRelationEntity();
    if (domain.id !== undefined) {
      entity.id = domain.id;
    }
    entity.userId = domain.userId;
    entity.sourceNodeId = domain.sourceNodeId;
    entity.targetNodeId = domain.targetNodeId;
    entity.type = domain.type;
    entity.description = domain.description;
    entity.voiceTranscriptId = domain.voiceTranscriptId;
    return entity;
  }
}
