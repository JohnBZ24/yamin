import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateVoiceProcessingDto {
  @ApiProperty({ example: 'f3a4e98d-6e1b-47e1-8f2c-5b9c1d8f7e2a' })
  @IsUUID()
  @IsNotEmpty()
  fileUuid: string;

  @ApiProperty({
    example: 'This is the raw transcription text from the voice note.',
  })
  @IsString()
  @IsOptional()
  rawText?: string;

  @ApiPropertyOptional({
    example: 'Asia/Beirut',
    description:
      'IANA timezone of the device, e.g. from Intl.DateTimeFormat().resolvedOptions().timeZone. ' +
      'Lets a spoken absolute time ("remind me at 2:43") resolve against the ' +
      "user's actual clock instead of the server's UTC. Falls back to a " +
      'configured default when omitted or invalid.',
  })
  @IsString()
  @IsOptional()
  timezone?: string;
}
