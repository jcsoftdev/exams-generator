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
 * Archiving rather than re-filing is deliberate: three of them would belong to
 * Inglés, but under which topic and grade is a guess, and the fourth is a maths
 * problem that belongs in no English course at all. Archiving takes them out of
 * the pool without inventing a classification.
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
    console.log(
      `[archive-non-spanish] ${row.course}: ${(row.bodyTypst ?? "").replace(/\s+/g, " ").slice(0, 70)}` +
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
