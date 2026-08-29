/** @type {import('jest').Config} */
module.exports = {
  ...require('./jest.config.js'),
  testRegex: '.*\\.integration-spec\\.ts$',
  // Testcontainers pulls and starts a real Postgres container per run —
  // give it enough headroom on a cold image cache. Runs from the host/CI
  // test process against a temporary container; the api/worker Docker
  // images never get Docker-in-Docker access.
  testTimeout: 60_000,
};
