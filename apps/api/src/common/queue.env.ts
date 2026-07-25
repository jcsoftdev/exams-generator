export interface RedisConnectionConfig {
  readonly host: string;
  readonly port: number;
}

/**
 * Resolves Redis connection config for every BullMQ queue in the app
 * (`generation`, `exam-versions`), mirroring `resolveDatabaseUrl()`
 * (`db/env.ts`) and `resolveStorageAdapter()` (`bank/storage-provider.ts`):
 * the SAME env var names the `api` service in `infra/docker-compose.yml` sets
 * (container-internal port 6379), falling back to the docker-compose
 * HOST-mapped port (6390) for bare local dev outside Docker.
 */
export function resolveRedisConnection(): RedisConnectionConfig {
  return {
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? 6390),
  };
}

/**
 * BullMQ key prefix for the whole queue namespace (queues, workers, events —
 * `BullModule.forRoot` shared option). `undefined` in dev/prod (BullMQ's
 * default "bull"). E2E jest specs set `BULLMQ_PREFIX` to a per-test-file value
 * (see `src/test-support/jest-setup.ts`) so parallel suites sharing the local
 * Redis NEVER steal each other's jobs — a job created by suite A must always
 * be processed by suite A's own worker (with suite A's mocked ports), and a
 * force-exited suite can no longer poison the next suite with a stalled job
 * that burns the 3-attempt exponential-backoff retry budget before the real
 * job is even touched.
 */
export function resolveBullmqPrefix(): string | undefined {
  return process.env.BULLMQ_PREFIX || undefined;
}
