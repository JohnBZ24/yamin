import { Expose } from 'class-transformer';

export class VoiceTranscript {
  @Expose()
  id: number;

  @Expose()
  fileUuid: string;

  @Expose()
  audioUrl: string | null;

  @Expose()
  rawText: string | null;

  @Expose()
  status: string;

  @Expose()
  summary: string | null;

  @Expose()
  embedding: number[] | null;

  @Expose()
  userId: number;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  deletedAt?: Date | null;
}
