const KEY_PID_PATTERN = /^bull-test-w\d+-p(\d+)-/;

/**
 * Pure decision logic for `jest-global-setup.ts`'s cleanup sweep, kept
 * separate from the Redis I/O so it's unit-testable without a real Redis.
 *
 * A key is stale (safe to unlink) when its embedded pid does NOT belong to a
 * currently-running process — i.e. a crashed/finished prior run's leftover.
 * A key whose pid IS alive belongs to a currently-running `pnpm test`
 * invocation (this run or a concurrent one on the same machine) and must be
 * left alone. A key with an unrecognized shape (no parseable pid) is treated
 * as stale too — it can't belong to a worker we'd recognize as live.
 */
export function selectStaleBullTestKeys(
  keys: readonly string[],
  isPidDead: (pid: number) => boolean,
): string[] {
  return keys.filter((key) => {
    const match = KEY_PID_PATTERN.exec(key);
    return !match || isPidDead(Number(match[1]));
  });
}
