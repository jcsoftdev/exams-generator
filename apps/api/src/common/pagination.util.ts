/**
 * Parses `value` as a number, falling back to `defaultValue` for
 * `undefined`/non-numeric input. Deliberately does NOT use `Number(value) ||
 * defaultValue` — that treats a valid `"0"` as falsy and silently swaps in
 * the default, which is the exact bug this module fixes (see
 * `clampPagination`'s `pageSize=0` case).
 */
function parseIntOrDefault(value: string | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * S6: pure clamp used by `GET /bank/questions` pagination. `page` floors at
 * 1 (never 0 or negative — Postgres `OFFSET` semantics assume 1-based paging
 * upstream in the repository); `pageSize` floors at 1 and caps at 100 (hard
 * upper bound so a client can never force an unbounded scan).
 * Non-numeric/undefined input falls back to the defaults (`page=1`,
 * `pageSize=20`).
 */
export function clampPagination(
  page: string | undefined,
  pageSize: string | undefined,
): { page: number; pageSize: number } {
  return {
    page: Math.max(1, parseIntOrDefault(page, 1)),
    pageSize: Math.min(100, Math.max(1, parseIntOrDefault(pageSize, 20))),
  };
}
