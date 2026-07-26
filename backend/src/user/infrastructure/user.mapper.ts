import { User } from '../domain/user';
import { UserEntity } from './user.entity';

export class UserMapper {
  static toDomain(entity: UserEntity): User {
    const user = new User();
    user.id = entity.id;
    user.email = entity.email;
    user.phoneNumber = entity.phoneNumber;
    user.password = entity.password;
    user.previousPassword = entity.previousPassword;
    user.firstName = entity.firstName;
    user.lastName = entity.lastName;
    user.profilePicture = entity.profilePicture;
    user.role = entity.role ?? null;
    user.createdAt = entity.createdAt;
    user.updatedAt = entity.updatedAt;
    user.deletedAt = entity.deletedAt;
    user.isEmailVerified = entity.isEmailVerified;

    return user;
  }

  static toPersistence(user: User): UserEntity {
    const entity = new UserEntity();

    if (user.id !== undefined) {
      entity.id = user.id;
    }

    entity.email = user.email;
    entity.phoneNumber = user.phoneNumber;
    entity.password = user.password;
    entity.firstName = user.firstName;
    entity.lastName = user.lastName;
    entity.profilePicture = user.profilePicture;
    entity.role = user.role;
    entity.isEmailVerified = user.isEmailVerified;

    return entity;
  }
}
