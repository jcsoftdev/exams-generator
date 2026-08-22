import Redis from "ioredis";
import { resolveRedisConnection } from "../common/queue.env";
import { selectStaleBullTestKeys } from "./stale-bull-test-keys";

/**
 * `true` only when `pid` does NOT belong to a currently-running process on
 * this machine — `process.kill(pid, 0)` sends no signal, it just probes
 * liveness (throws ESRCH if the pid is dead/unknown).
 */
function isPidDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

/**
 * Jest `globalSetup` — runs ONCE in the parent process before workers spawn.
 *
 * Deletes leftover `bull-test-*` keys from previous runs (prefixes are
 * `bull-test-w<N>-p<PID>-<uuid>` per test FILE — see `jest-setup.ts`).
 * Without this a stalled/delayed job left by a crashed run would be
 * re-processed by a later run's worker — burning its 3-attempt
 * exponential-backoff retry budget (up to ~35s) before the real test job is
 * touched, which is exactly how "Generation job did not complete in time"
 * poisoned subsequent runs.
 *
 * Only keys whose embedded pid is DEAD are unlinked — a key from a live,
 * concurrently-running `pnpm test` invocation on this machine is left alone
 * (its pid still resolves to a live process, so `isPidDead` returns false),
 * instead of unconditionally sweeping every `bull-test-*` match regardless
 * of whether it's still in active use.
 *
 * Only `bull-test-*` is touched — the dev/prod `bull:*` namespace (and any
 * other app's keys in the shared local Redis) is left alone. If Redis is
 * unreachable the cleanup is skipped with a warning instead of aborting the
 * run — pure unit specs don't need Redis at all.
 */
export default async function globalSetup(): Promise<void> {
  const { host, port } = resolveRedisConnection();
  const redis = new Redis({ host, port, lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    let cursor = "0";
    const staleKeys: string[] = [];
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", "bull-test-*", "COUNT", 1000);
      cursor = next;
      staleKeys.push(...selectStaleBullTestKeys(keys, isPidDead));
    } while (cursor !== "0");
    if (staleKeys.length > 0) {
      await redis.unlink(staleKeys);
    }
  } catch (error) {
    // Soft-fail: pure unit specs never touch Redis, so an unreachable local
    // Redis must not abort the WHOLE run — the e2e suites that do need it
    // will fail on their own with their own (clearer) connection errors.
    // eslint-disable-next-line no-console
    console.warn(
      `[jest-global-setup] could not clean stale bull-test-* keys (Redis unreachable at ${host}:${port}):`,
      error,
    );
  } finally {
    redis.disconnect();
  }
}
