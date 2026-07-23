import { Exclude, Expose } from 'class-transformer';
import { RoleEnum } from '../../utils/enums/roles.enum';

export class User {
  id: number;

  @Expose()
  email: string | null;

  @Expose()
  phoneNumber: string | null;

  @Exclude({ toPlainOnly: true })
  password?: string;

  @Exclude({ toPlainOnly: true })
  previousPassword?: string;

  @Expose()
  firstName: string | null;

  @Expose()
  lastName: string | null;

  @Expose()
  profilePicture?: string | null;

  @Expose()
  role: RoleEnum;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  isEmailVerified: boolean;
  @Expose()
  deletedAt?: Date | null;
}
