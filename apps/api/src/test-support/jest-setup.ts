import { randomUUID } from "node:crypto";

/**
 * Jest `setupFiles` — runs once per TEST FILE (Jest gives every test file its
 * own module registry/sandbox, even within the same worker process), before
 * any test module loads (so env is set before `AiModule` evaluates
 * `BullModule.forRoot`).
 *
 * Isolates each FILE's BullMQ namespace (`bull-test-w<N>-p<PID>-<uuid>:*`) so
 * e2e suites booting the full AppModule against the same local Redis never
 * steal each other's `generation` jobs — including two suites that land in
 * the SAME worker one after another. Without the uuid, isolation was only
 * per-worker: if suite A's `afterAll` tore down its app while a job was still
 * active/delayed, suite B landing in the same worker right after would boot
 * with the IDENTICAL prefix and could pick up and reprocess A's leaked job
 * with B's own (different) scripted `QuestionGeneratorPort` mock, delaying
 * the real job past the test's completion deadline ("Generation job did not
 * complete in time" flakes).
 *
 * The pid+uuid combination also isolates CONCURRENT `pnpm test` invocations
 * on one machine: without it two live runs could share a namespace, and run
 * B's globalSetup cleanup would UNLINK keys run A's workers are actively
 * consuming. The cleanup pattern (`bull-test-*`) still matches, so stale
 * keys from any previous run are collected regardless of pid/uuid.
 */
process.env.BULLMQ_PREFIX = `bull-test-w${process.env.JEST_WORKER_ID ?? "0"}-p${process.pid}-${randomUUID()}`;
