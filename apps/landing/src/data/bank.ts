/**
 * Central-bank scale, as published on the landing page.
 *
 * Lives in its own module rather than inline in `index.astro` so
 * `bank.spec.ts` can import the real values instead of regex-scraping the
 * page — a guard that parses its own subject rots the first time the file is
 * reformatted.
 *
 * Re-measured 2026-08-14. Query and provenance: see "Refreshing the bank
 * numbers" in `apps/landing/README.md`.
 *
 * `status = 'approved'` is load-bearing: an archived question never reaches an
 * exam, so quoting rows a customer cannot draw from would be advertising stock
 * that does not exist.
 *
 * Hardcoded on purpose: this page is statically built and must not depend on
 * the API being reachable at build time. Publishing a number we have not
 * measured is worse than publishing none.
 *
 * The previous value (1,066, measured 2026-07-30) predated the bulk harvest
 * that took the bank past 64k and sat 60x stale on a live marketing page for
 * two weeks. `bank.spec.ts` exists so that cannot happen quietly again — run
 * `pnpm --filter @exams-generator/landing test` before hand-editing anything
 * here.
 */
export const bank = {
  questions: 64215,
  /**
   * Pre-formatted (Peruvian convention: comma groups thousands) instead of
   * `toLocaleString`, so the baked output cannot shift with the ICU data of
   * whichever machine runs the static build.
   */
  questionsLabel: "64,215",
  courses: 21,
  topics: 276,
} as const;

/**
 * Same query, grouped by course. Order: most questions first.
 *
 * The totals here must sum to `bank.questions` — they come from one `GROUP BY`
 * over the same rows. `bank.spec.ts` enforces it, which is what catches the
 * half-update: someone bumps the headline number and forgets the breakdown.
 */
export const courses: readonly (readonly [string, number])[] = [
  ["Historia", 7091],
  ["Aritmética", 6113],
  ["Razonamiento Verbal", 5010],
  ["Razonamiento Matemático", 4337],
  ["Literatura", 4073],
  ["Biología", 3856],
  ["Lenguaje", 3799],
  ["Filosofía", 3181],
  ["Economía", 3056],
  ["Geografía", 2983],
  ["Inglés", 2887],
  ["Psicología", 2596],
  ["Educación Cívica", 2271],
  ["Álgebra", 2034],
  ["Química", 1873],
  ["Ecología", 1861],
  ["Física", 1821],
  ["Geometría", 1720],
  ["Comunicación", 1514],
  ["Trigonometría", 1330],
  ["Estadística y Probabilidades", 809],
];
