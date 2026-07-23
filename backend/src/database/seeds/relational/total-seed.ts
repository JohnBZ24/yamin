import { runPartialSeed } from './partial-seed';

export const runSeed = async () => {
  // Run partial seed first
  await runPartialSeed();

  // Then run additional seeding if needed
  // For now, we only have users, so partial seed is sufficient
  // If you need to seed more data after partial seed, add it here
};

void runSeed();
