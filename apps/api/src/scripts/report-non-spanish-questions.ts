import "reflect-metadata";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, pool } from "../db/client";
import { courses, questions, topics } from "../db/schema";

/**
 * Finds central-bank questions whose statement does not read as Spanish, in a
 * course where it should.
 *
 * The bank is shown to students sitting an exam in Spanish, so a statement in
 * English or French is unusable there — except in the `Inglés` course, where an
 * English statement is the whole point. This separates the two instead of
 * flagging every non-Spanish word.
 *
 * The signal is deliberately crude and biased toward false positives: short
 * function words are what actually distinguish the languages, and a human reads
 * the list afterwards.
 *
 * Usage: ts-node src/scripts/report-non-spanish-questions.ts [--limit 40]
 */
const FOREIGN_MARKERS = [
  // English
  "the ", " which ", " of the ", " is the ", " are ", " what is ", " find the ",
  " calculate the ", " following ", " answer ", " if the ",
  // French
  " quelle ", " quelles ", " est ", " sont ", " dans ", " soit ", " les ",
  " avec ", " pour ", " vrai ", " faux ",
];

const SPANISH_MARKERS = [
  " el ", " la ", " los ", " las ", " de ", " que ", " en ", " un ", " una ",
  " halle", " calcule", " determine", " cuál", " cuánto", " si ",
];

function score(text: string, markers: readonly string[]): number {
  const haystack = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  return markers.reduce((n, marker) => n + (haystack.includes(marker) ? 1 : 0), 0);
}

async function main(): Promise<void> {
  const limitIndex = process.argv.indexOf("--limit");
  const limit = limitIndex === -1 ? 40 : Number(process.argv[limitIndex + 1]);

  const rows = await db
    .select({
      id: questions.id,
      course: courses.name,
      body: questions.bodyTypst,
      sourceName: questions.sourceName,
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .innerJoin(courses, eq(topics.courseId, courses.id))
    .where(and(isNull(questions.tenantId), sql`${questions.bodyTypst} is not null`));

  const suspects = rows
    // Any English-teaching course is exempt, not just the one literally named
    // "Inglés" — the school stage calls it "Inglés como Lengua Extranjera".
    .filter((row) => !row.course.toLowerCase().includes("inglés"))
    .map((row) => ({ ...row, foreign: score(row.body ?? "", FOREIGN_MARKERS), spanish: score(row.body ?? "", SPANISH_MARKERS) }))
    .filter((row) => row.foreign >= 2 && row.foreign > row.spanish);

  const byCourse = new Map<string, number>();
  for (const row of suspects) {
    byCourse.set(row.course, (byCourse.get(row.course) ?? 0) + 1);
  }

  console.log(`${rows.length} central questions with a statement; ${suspects.length} do not read as Spanish outside the Inglés course`);
  for (const [course, count] of [...byCourse].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${course}`);
  }
  for (const row of suspects.slice(0, limit)) {
    console.log(`\n  ${row.course} | ${row.id}`);
    console.log(`    ${(row.body ?? "").replace(/\s+/g, " ").slice(0, 140)}`);
    console.log(`    ${row.sourceName ?? "(sin fuente)"}`);
  }

  await pool.end();
}

void main();
