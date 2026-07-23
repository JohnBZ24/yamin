import { NestFactory } from '@nestjs/core';
import { UserSeedService } from './user/user-seed.service';
import { SeedModule } from './seed.module';

export const runPartialSeed = async () => {
  const app = await NestFactory.create(SeedModule);

  await app.get(UserSeedService).run();

  await app.close();
};

void runPartialSeed();
