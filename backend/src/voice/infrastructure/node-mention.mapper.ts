import { NodeMention } from '../domain/node-mention';
import { NodeMentionEntity } from './node-mention.entity';

export class NodeMentionMapper {
  static toDomain(entity: NodeMentionEntity): NodeMention {
    const domain = new NodeMention();
    domain.id = entity.id;
    domain.nodeId = entity.nodeId;
    domain.voiceTranscriptId = entity.voiceTranscriptId;
    domain.description = entity.description;
    domain.createdAt = entity.createdAt;
    return domain;
  }

  static toPersistence(domain: NodeMention): NodeMentionEntity {
    const entity = new NodeMentionEntity();
    if (domain.id !== undefined) {
      entity.id = domain.id;
    }
    entity.nodeId = domain.nodeId;
    entity.voiceTranscriptId = domain.voiceTranscriptId;
    entity.description = domain.description;
    return entity;
  }
}
