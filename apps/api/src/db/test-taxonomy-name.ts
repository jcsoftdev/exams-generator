/**
 * The global `courses`/`topics` catalog has no `tenant_id` — every tenant sees
 * every row — so anything a test factory inserts there is visible to real
 * teachers in the exam builder and the bank tree until someone purges it
 * (audit 2026-08-20, H1: `/app/exams/new` listed "Test Course 81b7883e-…"
 * alongside the real syllabus).
 *
 * Test-factory names always carry the random UUID their fixture generated, so
 * that fragment is the signature this module keys off. It is deliberately the
 * SAME rule used by `scripts/purge-test-taxonomy.ts` to pick deletion
 * candidates — the purge is cleanup after the fact, this is the read-path
 * guard that keeps the junk out of product listings even before (or without)
 * a purge run.
 *
 * Four hex digits after the dash is what separates it from a harvested exam
 * label like "2020-1" or "2023-II"; eight hex before it keeps a plain year out.
 */
export const TEST_TAXONOMY_NAME_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}";

/** JS-side counterpart of {@link TEST_TAXONOMY_NAME_PATTERN}, for callers not writing SQL. */
export function isTestTaxonomyName(name: string): boolean {
  return new RegExp(TEST_TAXONOMY_NAME_PATTERN).test(name);
}
