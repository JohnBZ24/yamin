import { NestFactory } from '@nestjs/core';
import { UserSeedService } from './user/user-seed.service';
import { SeedModule } from './seed.module';

export const runPartialSeed = async () => {
  // The seeded accounts share one WELL-KNOWN password that is committed to
  // this repo. Planting them on a production database is handing out admin
  // access; real users register through /auth/email/register instead.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to seed demo accounts with a known password in production. ' +
        'Create real accounts via the register endpoint.',
    );
  }

  const app = await NestFactory.create(SeedModule);

  await app.get(UserSeedService).run();

  await app.close();
};

void runPartialSeed();
