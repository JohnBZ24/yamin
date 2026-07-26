import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';

import { UserService } from '../user/user.service';
import { RoleEnum } from '../utils/enums/roles.enum';
import { AuthEmailLoginDto } from './dto/auth-email-login.dto';
import { AuthRegisterDto } from './dto/auth-register.dto';
import {
  AuthInvalidCredentials,
  AuthInvalidRefreshToken,
} from './exceptions/auth.exceptions';
import { AllConfigType } from '../config/config.type';
import { User } from '../user/domain/user';
import { userFindOneAuthLogin } from '../user/infrastructure/relations-and-selects-options';

@Injectable()
export class AuthService {
  /** bcrypt("timing-equalizer-not-a-real-password", cost 10) — matches no one;
   *  exists only so unknown-email logins burn the same time as real ones. */
  private static readonly DUMMY_PASSWORD_HASH =
    '$2b$10$.0tcqxu7GdhXRX95pmRSouJ0YVzAlDhaRz5lJeO4TEu7b5l1YgrOu';

  sendOtp(email: string): { code: number } | PromiseLike<{ code: number }> {
    throw new Error('Method not implemented.');
  }

  verifyOtp(email: string, code: number): Promise<{
    token: string;
    refreshToken: string;
    tokenExpires: number;
    user: User;
  }> {
    throw new Error('Method not implemented.');
  }
  constructor(
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  /**
   * Public sign-up. The boilerplate always had UserService.create (email
   * uniqueness check + hashing included) — it was just never exposed as a
   * route, so the only way into the app was a seeded account. Registers and
   * signs the user straight in: there's no email-confirmation flow yet, so
   * bouncing a brand-new user back to the login form is pure friction.
   */
  async register(registerDto: AuthRegisterDto): Promise<{
    token: string;
    refreshToken: string;
    tokenExpires: number;
    user: User;
  }> {
    const user = await this.userService.create({
      createUserDto: {
        email: registerDto.email,
        password: registerDto.password,
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        phoneNumber: registerDto.phoneNumber ?? '',
        role: RoleEnum.user,
      },
    });

    const { token, refreshToken, tokenExpires } = await this.getTokensData({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return { token, refreshToken, tokenExpires, user };
  }

  async validateLogin(loginDto: AuthEmailLoginDto): Promise<{
    token: string;
    refreshToken: string;
    tokenExpires: number;
    user: User;
  }> {
    // Find user by email
    const user = await this.userService.findOneByEmail({
      email: loginDto.email,
      relationsAndSelects: userFindOneAuthLogin,
    });

    // Always run the bcrypt comparison, even when the email is unknown: an
    // early return here would answer measurably faster for unregistered
    // emails (~no bcrypt work vs ~100ms of it), which leaks account existence
    // through response time alone. The dummy hash is a bcrypt of a throwaway
    // string, never a real credential — comparing against it always fails but
    // costs the same as a real comparison.
    const isValidPassword = await bcrypt.compare(
      loginDto.password,
      user?.password || AuthService.DUMMY_PASSWORD_HASH,
    );

    // One vague error for every failure mode — see AuthInvalidCredentials for
    // why distinguishing them would let anyone enumerate registered emails.
    if (!user || !user.password || !isValidPassword) {
      throw new AuthInvalidCredentials();
    }

    // Generate tokens
    const { token, refreshToken, tokenExpires } = await this.getTokensData({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      refreshToken,
      token,
      tokenExpires,
      user,
    };
  }

  async refreshToken(refreshToken: string): Promise<{
    token: string;
    refreshToken: string;
    tokenExpires: number;
  }> {
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.configService.get('auth.refreshSecret', { infer: true }),
      });

      // Find user to ensure they still exist
      const user = await this.userService.findOne({
        id: payload.id as number,
      });

      if (!user) {
        throw new AuthInvalidRefreshToken();
      }

      // Generate new tokens
      const {
        token,
        refreshToken: newRefreshToken,
        tokenExpires,
      } = await this.getTokensData({
        id: user.id,
        email: user.email,
        role: user.role,
      });

      return {
        token,
        refreshToken: newRefreshToken,
        tokenExpires,
      };
    } catch (error) {
      throw new AuthInvalidRefreshToken();
    }
  }

  private async getTokensData(data: {
    id: User['id'];
    email: User['email'];
    role?: User['role'];
  }) {
    const tokenExpiresIn =
      this.configService.get('auth.expires', { infer: true }) || '1h';

    const refreshTokenExpiresIn =
      this.configService.get('auth.refreshExpires', { infer: true }) || '7d';

    // Parse time string to milliseconds (e.g., "1h" -> 3600000)
    const parseTimeToMs = (timeStr: string): number => {
      const match = timeStr.match(/^(\d+)([smhd])$/);
      if (!match) return 3600000; // default 1 hour
      const value = parseInt(match[1], 10);
      const unit = match[2];
      const multipliers: Record<string, number> = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
      };
      return value * (multipliers[unit] || 1000);
    };
    const tokenExpires = Date.now() + parseTimeToMs(tokenExpiresIn);

    const secret = this.configService.get('auth.secret', { infer: true });
    const refreshSecret = this.configService.get('auth.refreshSecret', {
      infer: true,
    });

    if (!secret || !refreshSecret) {
      throw new Error('JWT secrets are not configured');
    }

    const [token, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        {
          id: data.id,
          email: data.email || '',
          role: data.role || null,
        } as any,
        {
          secret,
          expiresIn: tokenExpiresIn,
        } as any,
      ),
      this.jwtService.signAsync(
        {
          id: data.id,
          email: data.email || '',
        } as any,
        {
          secret: refreshSecret,
          expiresIn: refreshTokenExpiresIn,
        } as any,
      ),
    ]);

    return {
      token,
      refreshToken,
      tokenExpires,
    };
  }
}
