import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class AskMemoryDto {
  @ApiProperty({ example: 'who is handling the pricing page?' })
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  question: string;

  @ApiPropertyOptional({
    default: 6,
    maximum: 20,
    description: 'How many memories to ground the answer in.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(20)
  limit?: number;
}
