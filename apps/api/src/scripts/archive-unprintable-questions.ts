import { and, eq, isNull, ne } from "drizzle-orm";
import { db, pool } from "../db/client";
import { questions } from "../db/schema";
import { findPrivateUseGlyph } from "../modules/bank/domain/find-private-use-glyph";

/**
 * Quarantines central-bank questions that cannot be printed: their statement
 * or one of their alternatives carries a legacy Symbol-font codepoint from
 * the private-use area, which every real font renders as a tofu box.
 *
 * `seed-collected-questions.ts` now refuses such entries at ingest, so this
 * only exists for rows seeded before that check. Idempotent — an
 * already-archived row is skipped by the `status <> 'archived'` predicate —
 * and cheap enough to run on every boot alongside the escaping backfill,
 * since the scan is over the central bank only and writes nothing once it
 * has caught up.
 *
 * Archiving rather than repairing is a deliberate decision: several of the
 * observed codepoints have no unambiguous Unicode counterpart, and a wrong
 * guess would print a different question than the source published. See
 * `find-private-use-glyph.ts`.
 */
export async function archiveUnprintableQuestions(): Promise<{ archived: number; scanned: number }> {
  const rows = await db
    .select({ id: questions.id, bodyTypst: questions.bodyTypst, alternatives: questions.alternatives })
    .from(questions)
    .where(and(isNull(questions.tenantId), ne(questions.status, "archived")));

  let archived = 0;

  for (const row of rows) {
    const alternatives = (row.alternatives ?? []) as readonly string[];
    const offender = [row.bodyTypst ?? "", ...alternatives]
      .map((value) => findPrivateUseGlyph(value))
      .find((found) => found !== undefined);
    if (offender === undefined) {
      continue;
    }

    await db.update(questions).set({ status: "archived" }).where(eq(questions.id, row.id));
    archived++;
    console.log(`[archive-unprintable-questions] ${row.id}: ${offender}`);
  }

  return { archived, scanned: rows.length };
}

if (require.main === module) {
  archiveUnprintableQuestions()
    .then(({ archived, scanned }) => {
      console.log(`[archive-unprintable-questions] archived ${archived} of ${scanned} scanned.`);
    })
    .catch((error: unknown) => {
      console.error("[archive-unprintable-questions] failed:", error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
