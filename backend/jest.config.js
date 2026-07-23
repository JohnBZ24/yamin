/**
 * Unit tests only by default — they need no Postgres, no Redis and no API key,
 * so `npm test` is safe to run anywhere, including CI without services.
 *
 * Integration tests (*.int-spec.ts) hit a real database and are run by
 * `npm run test:int`. They are excluded here rather than silently skipped, so a
 * green `npm test` never implies the integration suite passed.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['\\.int-spec\\.ts$'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
};
