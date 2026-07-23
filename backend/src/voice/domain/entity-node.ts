import { Expose } from 'class-transformer';

import { EntityNodeType } from './graph-vocabulary';

export class EntityNode {
  @Expose()
  id: number;

  @Expose()
  userId: number;

  @Expose()
  type: EntityNodeType;

  @Expose()
  name: string;

  // Deliberately not @Expose()d — an internal resolution key, never user-facing.
  normalizedName: string;

  @Expose()
  description: string | null;

  @Expose()
  mentionCount: number;

  @Expose()
  lastMentionedAt: Date | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  deletedAt?: Date | null;
}
