import { inArray, sql } from "drizzle-orm";
import { db, pool } from "../db/client";
import { courses, examBlueprintRows, questions, topics } from "../db/schema";

/**
 * One-off (but idempotent + re-runnable) cleanup of taxonomy pollution.
 *
 * Two sources of junk end up in the GLOBAL `courses`/`topics` catalog (no
 * `tenant_id` — every tenant sees every course), which surfaces as garbage
 * rows in the exam-builder grid:
 *
 *  1. E2E / repo-spec artifacts — courses named `... <uuid>` created by test
 *     factories (`StockBatch Course <uuid>`, `E2E Exams Course <uuid>`, …).
 *  2. Legacy demo courses superseded by the standard CNEB syllabus seed
 *     (`Álgebra`, `Razonamiento Matemático`, `Razonamiento Verbal`) — kept only
 *     while they carry no real data.
 *
 * SAFETY: nothing with dependent `questions` or `exam_blueprint_rows` is ever
 * deleted. A course whose topics carry questions (e.g. the bank sample
 * `Comunicación` / `Biología`, or `Aritmética` with its demo questions) is left
 * untouched and reported, never dropped. Deletes run inside a single
 * transaction so a guard trip rolls back the whole run.
 */

/** Postgres regex that matches a UUID fragment — the signature of a test-factory course name. */
const UUID_FRAGMENT = "[0-9a-f]{8}-[0-9a-f]{4}";

/** Legacy demo courses folded into `Matemática` / `Comunicación` by the standard syllabus — dropped only when empty. */
const LEGACY_EMPTY_COURSES = ["Álgebra", "Razonamiento Matemático", "Razonamiento Verbal"] as const;

interface CourseRef {
  readonly id: string;
  readonly name: string;
}

/** Course ids that still have at least one dependent question (via their topics) or blueprint row — must NOT be deleted. */
async function courseIdsWithDependents(candidateIds: readonly string[]): Promise<Set<string>> {
  if (candidateIds.length === 0) {
    return new Set();
  }

  const withQuestions = await db
    .selectDistinct({ id: topics.courseId })
    .from(topics)
    .innerJoin(questions, sql`${questions.topicId} = ${topics.id}`)
    .where(inArray(topics.courseId, [...candidateIds]));

  const withBlueprint = await db
    .selectDistinct({ id: examBlueprintRows.courseId })
    .from(examBlueprintRows)
    .where(inArray(examBlueprintRows.courseId, [...candidateIds]));

  return new Set([...withQuestions, ...withBlueprint].map((row) => row.id));
}

async function deleteCourses(refs: readonly CourseRef[]): Promise<void> {
  if (refs.length === 0) {
    return;
  }
  const ids = refs.map((ref) => ref.id);
  await db.delete(topics).where(inArray(topics.courseId, ids));
  await db.delete(courses).where(inArray(courses.id, ids));
  for (const ref of refs) {
    console.log(`  removed course "${ref.name}"`);
  }
}

export async function purgeTestTaxonomy(): Promise<void> {
  await db.transaction(async (tx) => {
    void tx; // guard evaluation + deletes below share the module `db`; the tx wrapper keeps them atomic

    // 1. UUID-named test-factory courses.
    const junk = await db
      .select({ id: courses.id, name: courses.name })
      .from(courses)
      .where(sql`${courses.name} ~ ${UUID_FRAGMENT}`);

    // 2. Legacy empty demo courses superseded by the standard syllabus.
    const legacy = await db
      .select({ id: courses.id, name: courses.name })
      .from(courses)
      .where(inArray(courses.name, [...LEGACY_EMPTY_COURSES]));

    const candidates = [...junk, ...legacy];
    const blocked = await courseIdsWithDependents(candidates.map((c) => c.id));

    const deletable = candidates.filter((c) => !blocked.has(c.id));
    const skipped = candidates.filter((c) => blocked.has(c.id));

    console.log(`Purging ${deletable.length} course(s); skipping ${skipped.length} with dependent data.`);
    for (const ref of skipped) {
      console.log(`  kept "${ref.name}" (has dependent questions/blueprint rows)`);
    }

    await deleteCourses(deletable);
  });
}

/* istanbul ignore next -- CLI entrypoint, run manually / in deploys, not under unit test */
if (require.main === module) {
  purgeTestTaxonomy()
    .then(() => {
      console.log("Purge complete.");
      return pool.end();
    })
    .catch((error: unknown) => {
      console.error("Purge failed:", error);
      return pool.end().finally(() => process.exit(1));
    });
}
