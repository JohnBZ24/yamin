import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { JwtPayloadType } from './types/jwt-payload.type';
import { AllConfigType } from '../../config/config.type';
import { UserRepository } from '../../user/infrastructure/user.repository';
import { User } from '../../user/domain/user';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService<AllConfigType>,
    private readonly userRepository: UserRepository,
  ) {
    const secret = configService.get('auth.secret', { infer: true });
    if (!secret) {
      throw new Error('AUTH_JWT_SECRET is not defined');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayloadType): Promise<User> {
    if (!payload.id) {
      throw new UnauthorizedException();
    }

    const user = await this.userRepository.findOne({
      fields: { id: payload.id as number },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    return user;
  }
}
