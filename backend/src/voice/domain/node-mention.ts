import { Expose } from 'class-transformer';

export class NodeMention {
  @Expose()
  id: number;

  @Expose()
  nodeId: number;

  @Expose()
  voiceTranscriptId: number;

  @Expose()
  description: string | null;

  @Expose()
  createdAt: Date;
}
