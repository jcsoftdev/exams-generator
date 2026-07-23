const moduleNameMapper = {
  "^@exams-generator/shared$": "<rootDir>/../../../packages/shared/src/index.ts",
  "^@exams-generator/shared/(.*)$": "<rootDir>/../../../packages/shared/src/$1",
};

/** @type {import('jest').Config} */
module.exports = {
  rootDir: "src",
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  // Non-e2e specs (unit specs, plus repository/seed specs that hit real
  // Postgres directly without booting the HTTP app) keep jest's fast 5s
  // default timeout so a genuinely hung test (forgotten await, unresolved
  // mock promise) fails fast instead of silently waiting out the e2e
  // suites' much longer budget below.
  projects: [
    {
      displayName: "non-e2e",
      preset: "ts-jest",
      testEnvironment: "node",
      rootDir: "src",
      testRegex: "(?<!\\.e2e)\\.spec\\.ts$",
      moduleFileExtensions: ["js", "json", "ts"],
      moduleNameMapper,
    },
    {
      displayName: "e2e",
      preset: "ts-jest",
      testEnvironment: "node",
      rootDir: "src",
      testRegex: "\\.e2e\\.spec\\.ts$",
      moduleFileExtensions: ["js", "json", "ts"],
      moduleNameMapper,
      // The e2e suites exercise the REAL Typst compiler and real Postgres
      // (only the AI provider is mocked) — a single exam-version batch is
      // several real compiles, which blows past jest's 5s default on a
      // loaded machine. The timeout firing mid-request was also the root
      // cause of the "Cannot use a pool after calling end on the pool"
      // cascades: the in-flight request outlived the test and afterAll
      // closed the pool under it. Scoped to this project only — a hung
      // non-e2e test should still fail fast, not wait out this budget.
      testTimeout: 60_000,
      // Per-test-file BullMQ namespace isolation + stale test-queue cleanup
      // — see the two files' doc comments (cross-suite job theft /
      // stalled-job poisoning were the systemic causes of the AI e2e
      // flakiness). Only e2e suites boot the real AppModule/BullMQ, so
      // these don't need to run for non-e2e specs either.
      setupFiles: ["<rootDir>/test-support/jest-setup.ts"],
      globalSetup: "<rootDir>/test-support/jest-global-setup.ts",
    },
  ],
};
