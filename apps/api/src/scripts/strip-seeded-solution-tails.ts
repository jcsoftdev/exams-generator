import { and, eq, isNull, sql } from "drizzle-orm";
import { db, pool } from "../db/client";
import { questions } from "../db/schema";
import { stripSolutionTail } from "../modules/bank/domain/strip-solution-tail";

/**
 * Postgres pre-filter — the same markers `stripSolutionTail` anchors on, in
 * one regex, so this reads a few dozen candidate rows instead of all 65k and
 * re-serialising every one of them.
 *
 * It is deliberately WIDER than the TS anchors (no punctuation demands, no
 * caps rules): a false candidate costs one no-op comparison, while a missed
 * one leaves the answer key printed on a student's exam. `stripSolutionTail`
 * is the single authority on what actually gets cut.
 */
const CANDIDATE_PATTERN =
  "(?i)(\\yrpta\\y|\\yclaves?\\s*-\\s*respuestas\\y|\\yclave\\s*[:.]|Key\\s*:|\\ysolucionario\\y|\\ysoluci(o|ó)n\\s*:|\\yresoluci(o|ó)n\\s*[0-9]|ver respuesta correcta|\\yrespuesta\\s+[a-e]\\y|explicaci(o|ó)n breve|\\y[0-9]\\s*(da|ra|ta|va|ma)\\.?\\s*prueba\\y)";

/**
 * Cuts the source page's answer key, solucionario and navigation chrome off
 * the alternatives of already-seeded CENTRAL-BANK questions (audit
 * 2026-08-20, H2 — the reproduced instance was an option reading
 * "15 2da. Prueba Examen de Admisión 2020-1", and the commonest shape is a
 * last option ending in `Rpta.: "C"`, which hands the student the answer).
 *
 * Why in place rather than re-derived from the JSON sources, the way
 * `normalize-collected-content.ts` works: the defect spans corpora. The
 * collected scrapes are re-derivable, the harvested lots are not (they dedupe
 * on a figure-aware hash and are never rewritten once seeded), and a couple of
 * rows predate both paths. Working off the stored value covers all three, and
 * costs nothing in safety because `stripSolutionTail` is idempotent — its
 * output contains no anchor, so a second pass is a no-op.
 *
 * Scoped to `tenant_id IS NULL`. A teacher's own question is theirs; if they
 * typed "Rpta." into an option, that is not ours to rewrite.
 */
export async function stripSeededSolutionTails(): Promise<{ updated: number; checked: number }> {
  const candidates = await db
    .select({ id: questions.id, alternatives: questions.alternatives })
    .from(questions)
    .where(
      and(
        isNull(questions.tenantId),
        sql`${questions.alternatives} IS NOT NULL`,
        sql`EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${questions.alternatives}) AS alternative
          WHERE alternative ~ ${CANDIDATE_PATTERN}
        )`,
      ),
    );

  let updated = 0;

  for (const candidate of candidates) {
    const current = candidate.alternatives as string[] | null;
    if (current === null) {
      continue;
    }

    const stripped = current.map((alternative) => stripSolutionTail(alternative));
    if (stripped.every((alternative, index) => alternative === current[index])) {
      continue;
    }

    await db.update(questions).set({ alternatives: stripped }).where(eq(questions.id, candidate.id));
    updated++;
  }

  return { updated, checked: candidates.length };
}

/* istanbul ignore next -- CLI entrypoint, run manually / from the boot seed, not under unit test */
if (require.main === module) {
  stripSeededSolutionTails()
    .then(({ updated, checked }) => {
      console.log(`[strip-seeded-solution-tails] cleaned ${updated} rows of ${checked} candidates.`);
    })
    .catch((error: unknown) => {
      console.error("[strip-seeded-solution-tails] failed:", error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
