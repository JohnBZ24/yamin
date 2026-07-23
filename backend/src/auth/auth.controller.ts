import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { AuthEmailLoginDto } from './dto/auth-email-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { User } from '../user/domain/user';
import { ApiLogin } from './swagger/login.swagger';
import { ApiRefreshToken } from './swagger/refresh-token.swagger';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('email/login')
  @HttpCode(HttpStatus.OK)
  @ApiLogin()
  async login(@Body() loginDto: AuthEmailLoginDto): Promise<{
    token: string;
    refreshToken: string;
    tokenExpires: number;
    user: User;
  }> {
    return this.authService.validateLogin(loginDto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiRefreshToken()
  async refreshToken(@Body() refreshTokenDto: RefreshTokenDto): Promise<{
    token: string;
    refreshToken: string;
    tokenExpires: number;
  }> {
    return this.authService.refreshToken(refreshTokenDto.refreshToken);
  }
  @Post('send')
  async sendOtp(@Body() requestOtp: RequestOtpDto): Promise<{ code: number }> {
    return this.authService.sendOtp(requestOtp.email);
  }
  @Post('verify')
  async verifyOtp(@Body() verifyOtp: VerifyOtpDto): Promise<{
    token: string;
    refreshToken: string;
    tokenExpires: number;
    user: User;
  }> {
    return this.authService.verifyOtp(verifyOtp.email, verifyOtp.code);
  }
}
