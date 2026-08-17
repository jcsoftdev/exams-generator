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
      // `seed-idempotency` is excluded here and given its own serial project
      // below — see the comment there for why it cannot share workers.
      testPathIgnorePatterns: ["<rootDir>/db/seed-idempotency\\.spec\\.ts$"],
      moduleFileExtensions: ["js", "json", "ts"],
      moduleNameMapper,
    },
    {
      // `seed-idempotency` runs the REAL `seed()` twice, which rewrites the
      // whole GLOBAL taxonomy (courses/topics/universities/blueprint
      // templates) — the same rows a dozen other non-e2e specs read while
      // they run. Under jest's default parallel workers, sharing one local
      // Postgres, it failed intermittently: not flakiness in the test, but a
      // genuine write-vs-read race that only this spec can cause, because
      // it's the only one that mutates global taxonomy wholesale.
      //
      // Its own project so the `test` script can run it with `--runInBand`
      // between the two existing phases — same shape the e2e project already
      // uses, rather than serializing all 758 non-e2e tests to fix one.
      // (jest has no per-project `maxWorkers`; serialization has to come from
      // the invocation.)
      displayName: "db-serial",
      preset: "ts-jest",
      testEnvironment: "node",
      rootDir: "src",
      testRegex: "db/seed-idempotency\\.spec\\.ts$",
      moduleFileExtensions: ["js", "json", "ts"],
      moduleNameMapper,
      // Two full seeds of the real syllabus against real Postgres — needs the
      // same raised budget as e2e. See `jest-timeout.ts` for why this is a
      // setup file and not a `testTimeout` key.
      setupFilesAfterEnv: ["<rootDir>/test-support/jest-timeout.ts"],
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
      //
      // This USED to be `testTimeout: 60_000` right here, and Jest 29 was
      // silently rejecting it: `testTimeout` is not a per-project option, so
      // the whole protection described above was never in effect and e2e ran
      // on the 5s default. Moved to a `setupFilesAfterEnv` that calls
      // `jest.setTimeout()` — see `jest-timeout.ts`.
      setupFilesAfterEnv: ["<rootDir>/test-support/jest-timeout.ts"],
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
