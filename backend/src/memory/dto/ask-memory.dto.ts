import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class AskMemoryDto {
  @ApiProperty({ example: 'who is handling the pricing page?' })
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  question: string;

  @ApiPropertyOptional({
    description:
      'Continue an existing conversation. Omit to start a new one — the response returns the uuid to keep using.',
  })
  @IsOptional()
  @IsUUID()
  conversationUuid?: string;

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
