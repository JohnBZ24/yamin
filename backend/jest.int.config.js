/**
 * Integration tests. These talk to a real Postgres — the point is to exercise
 * the SQL (upserts, partial unique indexes, ON CONFLICT, the merge), which a
 * mocked repository cannot test at all. Every bug found in the memory graph so
 * far lived in SQL, not in TypeScript.
 *
 * Requires: docker compose up -d postgres && npm run migration:run
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.int-spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  // Real DB round-trips; the default 5s is too tight.
  testTimeout: 30000,
  // These suites share tables — running them in parallel would make them fight.
  maxWorkers: 1,
};
