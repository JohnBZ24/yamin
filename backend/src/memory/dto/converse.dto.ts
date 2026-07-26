import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ConverseDto {
  @ApiProperty({ example: 'my boss karim wants the report by monday' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;

  @ApiPropertyOptional({
    description:
      'Continue an existing conversation. Omit to start a new one — the response returns the uuid to keep using.',
  })
  @IsOptional()
  @IsUUID()
  conversationUuid?: string;

  @ApiPropertyOptional({
    example: 'Asia/Beirut',
    description:
      'IANA timezone of the device. Lets "remind me at 5" resolve against the '
      + "user's clock when the message turns out to be a reminder request.",
  })
  @IsString()
  @IsOptional()
  timezone?: string;
}
