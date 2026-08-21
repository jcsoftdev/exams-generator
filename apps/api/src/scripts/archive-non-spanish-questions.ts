import { and, eq, isNull, ne } from "drizzle-orm";
import { db, pool } from "../db/client";
import { courses, questions, topics } from "../db/schema";
import { readsAsSpanish } from "../modules/bank/domain/reads-as-spanish";

/**
 * Quarantines central-bank questions whose statement is not in Spanish, in a
 * course where that makes them unusable.
 *
 * The app builds exams for students sitting them in Spanish, so an English or
 * French statement cannot be shown — except in an English-teaching course,
 * where an English statement IS the question. Those are exempt by course name.
 *
 * Where they come from: the web-sourced corpus mixes channels, and a few blog
 * pages filed English grammar drills under Razonamiento Verbal, Filosofía and
 * Economía, plus one Spanish word problem someone had published translated into
 * English. Five rows out of 65k — small, and exactly the kind of thing nobody
 * finds by reading.
 *
 * This is the LAST line, not the fix. The fix is upstream and comes in two
 * shapes, depending on what the question is:
 *
 * - The question's subject is English (a grammar or vocabulary exercise, a
 *   reading comprehension over an English passage): it belongs to the Inglés
 *   course, where an English statement is the point. Re-file it.
 * - The question is a Spanish exam question that someone published translated:
 *   translate it back. `tools/harvest/check_translation.py` is what keeps a
 *   translation from moving the key.
 *
 * `fix-non-spanish-questions.ts` did exactly that for the five rows this found,
 * so this archiver should now find nothing. When it does fire, the row it names
 * is a work item — re-file it or translate it — not something to leave archived.
 *
 * Idempotent: an already-archived row is skipped by `status <> 'archived'`.
 */
export async function archiveNonSpanishQuestions(): Promise<{ archived: number; scanned: number }> {
  const rows = await db
    .select({
      id: questions.id,
      course: courses.name,
      bodyTypst: questions.bodyTypst,
      sourceName: questions.sourceName,
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .innerJoin(courses, eq(topics.courseId, courses.id))
    .where(and(isNull(questions.tenantId), ne(questions.status, "archived")));

  let archived = 0;

  for (const row of rows) {
    if (row.course.toLowerCase().includes("inglés")) {
      continue;
    }
    if (readsAsSpanish(row.bodyTypst ?? "")) {
      continue;
    }

    await db.update(questions).set({ status: "archived" }).where(eq(questions.id, row.id));
    archived++;
    console.warn(
      `[archive-non-spanish] ARCHIVED ${row.id} (${row.course}) — translate it or re-file it under ` +
        `Inglés, then re-approve: ${(row.bodyTypst ?? "").replace(/\s+/g, " ").slice(0, 70)}` +
        ` — ${row.sourceName ?? "(sin fuente)"}`,
    );
  }

  return { archived, scanned: rows.length };
}

/* istanbul ignore next -- CLI entrypoint, exercised manually, not under unit test */
if (require.main === module) {
  archiveNonSpanishQuestions()
    .then(({ archived, scanned }) => {
      console.log(`[archive-non-spanish] archived ${archived} of ${scanned} central questions`);
      return pool.end();
    })
    .catch((error: unknown) => {
      console.error("Fatal error:", error);
      process.exitCode = 1;
    });
}
