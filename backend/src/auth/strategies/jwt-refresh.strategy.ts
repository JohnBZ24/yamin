import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { JwtRefreshPayloadType } from './types/jwt-refresh-payload.type';
import { AllConfigType } from '../../config/config.type';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(configService: ConfigService<AllConfigType>) {
    const refreshSecret = configService.get('auth.refreshSecret', {
      infer: true,
    });
    if (!refreshSecret) {
      throw new Error('AUTH_REFRESH_SECRET is not defined');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: refreshSecret,
    });
  }

  public validate(payload: JwtRefreshPayloadType): JwtRefreshPayloadType {
    if (!payload.id || !payload.email) {
      throw new UnauthorizedException();
    }
    return payload;
  }
}
