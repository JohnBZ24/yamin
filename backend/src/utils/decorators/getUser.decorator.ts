import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtPayloadType } from '../types/jwt-payload.type';
// import { JwtPayloadType } from '../../auth/strategies/types/jwt-payload.type';

export const GetUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as JwtPayloadType;

    if (!user || !user.id) {
      console.error('GetUser decorator - User or user.id not found in token');
      throw new UnauthorizedException('User ID not found in token');
    }

    return user.id;
  },
);
