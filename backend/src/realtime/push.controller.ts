import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../utils/decorators/getUser.decorator';
import { PushService } from './push.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';

@ApiTags('Push')
@Controller({ path: 'push', version: '1' })
export class PushController {
  constructor(private readonly push: PushService) {}

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Register this device for reminder notifications',
    description:
      'Reminders are delivered over a socket only while the app is open. Registering a push token is what lets a reminder arrive when the app is closed.',
  })
  @UseGuards(JwtAuthGuard)
  @Post('token')
  @HttpCode(HttpStatus.OK)
  async register(
    @Body() dto: RegisterPushTokenDto,
    @GetUser() userId: number,
  ): Promise<{ registered: boolean }> {
    await this.push.registerToken(userId, dto.token, dto.platform);
    return { registered: true };
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Stop sending notifications to this device' })
  @UseGuards(JwtAuthGuard)
  @Delete('token')
  @HttpCode(HttpStatus.OK)
  async unregister(
    @Body() dto: RegisterPushTokenDto,
  ): Promise<{ removed: boolean }> {
    await this.push.removeToken(dto.token);
    return { removed: true };
  }
}
