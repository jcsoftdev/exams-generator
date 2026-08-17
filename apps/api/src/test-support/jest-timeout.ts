/**
 * Raises the per-test timeout for the suites that talk to real infrastructure.
 *
 * WHY THIS FILE EXISTS INSTEAD OF A `testTimeout` KEY:
 * `jest.config.js` used to set `testTimeout: 60_000` inside the `e2e` project.
 * Jest 29 does not accept `testTimeout` as a PER-PROJECT option — it only reads
 * it at the root of the config — so it silently rejected it with
 * `Validation Warning: Unknown option "testTimeout"` and every e2e test kept
 * running on jest's 5s default. The long comment in `jest.config.js` explaining
 * why 60s was needed described a protection that was never in effect.
 *
 * That mattered: the e2e suites drive the REAL Typst compiler and real
 * Postgres, and a single exam-version batch is several real compiles. On a
 * loaded machine those blow past 5s, and a timeout firing MID-REQUEST is the
 * documented root cause of the `Cannot use a pool after calling end on the
 * pool` cascades — the in-flight request outlives the test and `afterAll`
 * closes the pool underneath it.
 *
 * `jest.setTimeout()` has to run in `setupFilesAfterEnv` (after the test
 * framework is installed), not `setupFiles` (before it) — which is why this is
 * a separate file from `jest-setup.ts`.
 *
 * Deliberately NOT applied to the `non-e2e` project: a hung unit test should
 * fail fast on the 5s default rather than wait out this budget.
 */
jest.setTimeout(60_000);
