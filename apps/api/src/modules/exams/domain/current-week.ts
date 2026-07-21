const MS_PER_DAY = 86_400_000;

/**
 * `cycles` never persists a "current week" column (design doc §3.3) — it's
 * derived on read from `starts_on` + `week_length_days`. Dates are compared
 * at UTC calendar-day granularity (not raw ms difference) so time-of-day and
 * DST offsets on either input can't shift the result by a day.
 *
 * Clamps at 0 for `today` values before the cycle start — a cycle that
 * hasn't begun yet is week 0, never negative.
 */
export function computeCurrentWeek(startsOn: Date, weekLengthDays: number, today: Date): number {
  const startUtc = Date.UTC(startsOn.getUTCFullYear(), startsOn.getUTCMonth(), startsOn.getUTCDate());
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dayDiff = Math.floor((todayUtc - startUtc) / MS_PER_DAY);

  return Math.max(0, Math.floor(dayDiff / weekLengthDays));
}
