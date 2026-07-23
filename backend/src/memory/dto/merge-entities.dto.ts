import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsInt, Min } from 'class-validator';

export class MergeEntitiesDto {
  @ApiProperty({
    example: [4, 7],
    description:
      'Entity ids to fold into this one. They are soft-deleted; their mentions and relations move to the survivor.',
  })
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @ArrayUnique()
  @ArrayMinSize(1)
  // A merge is irreversible from the UI's point of view; a runaway list would
  // collapse someone's whole graph into one node in a single call.
  @ArrayMaxSize(20)
  sourceIds: number[];
}
