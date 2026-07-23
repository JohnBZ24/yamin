import { User } from '../../../user/domain/user';
import { RoleEnum } from '../../../utils/enums/roles.enum';

export type JwtPayloadType = Pick<User, 'id' | 'email'> & {
  role?: RoleEnum | null;
  iat: number;
  exp: number;
};
