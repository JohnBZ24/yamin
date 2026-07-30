import { VoiceTranscript } from '../domain/voice-transcript';
import { VoiceTranscriptEntity } from './voice-transcript.entity';

export class VoiceTranscriptMapper {
  static toDomain(entity: VoiceTranscriptEntity): VoiceTranscript {
    const domain = new VoiceTranscript();
    domain.id = entity.id;
    domain.fileUuid = entity.fileUuid;
    domain.audioUrl = entity.audioUrl;
    domain.rawText = entity.rawText;
    domain.status = entity.status;
    domain.summary = entity.summary;
    domain.peaks = entity.peaks;
    domain.embedding = entity.embedding;
    domain.userId = entity.userId;
    domain.createdAt = entity.createdAt;
    domain.updatedAt = entity.updatedAt;
    domain.deletedAt = entity.deletedAt;
    return domain;
  }

  static toPersistence(domain: VoiceTranscript): VoiceTranscriptEntity {
    const entity = new VoiceTranscriptEntity();
    if (domain.id !== undefined) {
      entity.id = domain.id;
    }
    entity.fileUuid = domain.fileUuid;
    entity.audioUrl = domain.audioUrl;
    entity.rawText = domain.rawText;
    entity.status = domain.status;
    entity.summary = domain.summary;
    entity.peaks = domain.peaks;
    entity.embedding = domain.embedding;
    entity.userId = domain.userId;
    return entity;
  }
}
