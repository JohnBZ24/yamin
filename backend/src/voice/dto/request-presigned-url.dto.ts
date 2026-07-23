import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RequestPresignedUrlDto {
  @ApiPropertyOptional({ example: '.m4a' })
  @IsString()
  @IsOptional()
  fileExtension?: string;
}
