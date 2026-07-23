import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsString, Max, Min, IsOptional, MaxLength, MinLength } from 'class-validator';

export class SearchMemoryDto {
  @ApiProperty({ example: 'what did sarah say about pricing' })
  @IsString()
  @MinLength(2)
  // Every query is embedded, which is a paid API call sized by input; an
  // unbounded string is both a cost and a latency hazard.
  @MaxLength(1000)
  q: string;

  @ApiPropertyOptional({ default: 10, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({
    default: 0.2,
    description: 'Minimum cosine similarity. Below this a note is not a match.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minSimilarity?: number;
}
