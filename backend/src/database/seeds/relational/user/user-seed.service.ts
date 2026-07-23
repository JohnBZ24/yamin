import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { UserEntity } from '../../../../user/infrastructure/user.entity';
import { RoleEnum } from '../../../../utils/enums/roles.enum';

@Injectable()
export class UserSeedService {
  constructor(
    @InjectRepository(UserEntity)
    private repository: Repository<UserEntity>,
  ) {}

  async run(): Promise<boolean> {
    const salt = await bcrypt.genSalt();
    const password = await bcrypt.hash('cbkthebest', salt);

    let created = false;

    // Helper function to safely create user
    const createUserIfNotExists = async (
      email: string,
      userData: Partial<UserEntity>,
    ): Promise<boolean> => {
      const existing = await this.repository.findOne({
        where: { email },
        withDeleted: true, // Check including soft-deleted records
      });

      if (!existing) {
        try {
          await this.repository.save(
            this.repository.create({
              ...userData,
              email,
              password,
            }),
          );
          return true;
        } catch (error: any) {
          // Ignore duplicate key errors (user might have been created concurrently)
          if (error?.code === '23505') {
            return false;
          }
          throw error;
        }
      }
      return false;
    };

    // Super Admin user
    const superAdminCreated = await createUserIfNotExists(
      'cbksuperadmin@gmail.com',
      {
        firstName: 'Super',
        lastName: 'Admin',
        phoneNumber: '+1234567890',
        profilePicture: null,
        role: RoleEnum.superAdmin,
      },
    );
    if (superAdminCreated) created = true;

    // Admin user
    const adminCreated = await createUserIfNotExists('cbkadmin@gmail.com', {
      firstName: 'Admin',
      lastName: 'User',
      phoneNumber: '+1234567891',
      profilePicture: null,
      role: RoleEnum.admin,
    });
    if (adminCreated) created = true;

    // Regular user
    const userCreated = await createUserIfNotExists('cbk@gmail.com', {
      firstName: 'Regular',
      lastName: 'User',
      phoneNumber: '+1234567892',
      profilePicture: null,
      role: RoleEnum.user,
    });
    if (userCreated) created = true;

    return created;
  }
}
