import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * Upper bound on the waveform the client may send.
 *
 * The bubble draws a few dozen bars, so anything beyond this is data nobody can
 * see — and the column is client-supplied, which makes an unbounded array a
 * free way to fill the database.
 */
const MAX_PEAKS = 64;

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

  @ApiPropertyOptional({
    type: [Number],
    example: [4, 18, 62, 90, 71, 33, 12],
    description:
      'Amplitude envelope of the recording, 0-100 per slice, measured on the ' +
      'device while recording. Drawn as the waveform on the note. Omitted for ' +
      'typed notes, which have no audio.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_PEAKS)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(100, { each: true })
  @IsOptional()
  peaks?: number[];
}
