import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ClassifyIntentDto {
  @ApiProperty({ example: 'what did I say about pricing?' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text: string;
}
