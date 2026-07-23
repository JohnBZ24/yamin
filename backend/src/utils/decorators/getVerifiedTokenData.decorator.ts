import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';

export const GetVerifiedTokenData = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();

    const token =
      request.headers['authorization']?.replace('Bearer ', '') ||
      request.headers['Authorization']?.replace('Bearer ', '') ||
      request.headers['token'] ||
      request.headers['Token'] ||
      request.query.token ||
      request.query.Token;

    if (!token) {
      throw new UnauthorizedException('Token not found');
    }

    try {
      const configService = new ConfigService();
      const jwtSecret =
        configService.get<string>('AUTH_JWT_SECRET', { infer: true }) ||
        'secret';
      const decoded = jwt.verify(token, jwtSecret);
      return decoded;
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  },
);
