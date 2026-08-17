import { inArray, sql } from "drizzle-orm";
import { db, pool } from "../db/client";
import {
  courses,
  examBlueprintRows,
  examBlueprintTemplateRows,
  examQuestions,
  generationJobs,
  questions,
  syllabusWeekMaps,
  topics,
} from "../db/schema";

/**
 * One-off (but idempotent + re-runnable) cleanup of taxonomy pollution.
 *
 * Two sources of junk end up in the GLOBAL `courses`/`topics` catalog (no
 * `tenant_id` — every tenant sees every course), which surfaces as garbage
 * rows in the exam-builder grid:
 *
 *  1. E2E / repo-spec artifacts — courses named `... <uuid>` created by test
 *     factories (`StockBatch Course <uuid>`, `E2E Exams Course <uuid>`, …).
 *     `afterAll` hooks in each spec are supposed to delete these, but any
 *     interrupted run (Ctrl+C, timeout, crashed `beforeAll`) skips cleanup
 *     and leaves orphans — including their generated `questions` and
 *     `generation_jobs` rows. Those are themselves test artifacts, not real
 *     data, so they don't protect the course from deletion.
 *  2. Legacy demo courses superseded by the standard CNEB syllabus seed
 *     (`Álgebra`, `Razonamiento Matemático`, `Razonamiento Verbal`) — kept only
 *     while they carry no real data.
 *
 * SAFETY: a course is only skipped if one of its questions was actually used
 * in a real exam (`exam_questions`), it has an `exam_blueprint_rows` or
 * `exam_blueprint_template_rows` entry, or it's mapped into an actual
 * syllabus (`syllabus_week_maps`) — those are signals of real usage, not
 * just test-factory noise. Deletes run inside a single transaction so a
 * guard trip rolls back the whole run.
 */

/** Postgres regex that matches a UUID fragment — the signature of a test-factory course name. */
const UUID_FRAGMENT = "[0-9a-f]{8}-[0-9a-f]{4}";

/**
 * Names that were once demo-only courses folded into `Matemática` /
 * `Comunicación` by the school syllabus — dropped ONLY when empty.
 *
 * READ THE "only when empty" PART BEFORE TOUCHING THIS LIST. These three names
 * are no longer just legacy: under `stage: 'preuniversitario'` they are
 * first-class courses of the preuni syllabus, and today they hold thousands of
 * approved questions each (Álgebra ~2k, Razonamiento Matemático ~4.3k,
 * Razonamiento Verbal ~5k). What keeps the purge from eating them is
 * `courseIdsWithRealUsage` — they carry blueprint-template rows — plus the
 * emptiness check, not this list.
 *
 * So the list is safe but no longer self-explanatory: it reads as "these are
 * legacy junk" when the same names are now core taxonomy. Matching by NAME
 * alone is the fragile part — it ignores `stage`, which is the column that
 * actually separates the school-era course from the preuni one. If this ever
 * needs to grow, scope it by `(stage, name)` instead.
 */
const LEGACY_EMPTY_COURSES = ["Álgebra", "Razonamiento Matemático", "Razonamiento Verbal"] as const;

interface CourseRef {
  readonly id: string;
  readonly name: string;
}

/** Course ids whose questions were pulled into a real exam, or that carry a blueprint row — must NOT be deleted. */
async function courseIdsWithRealUsage(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  candidateIds: readonly string[],
): Promise<Set<string>> {
  if (candidateIds.length === 0) {
    return new Set();
  }

  const withExamUsage = await tx
    .selectDistinct({ id: topics.courseId })
    .from(topics)
    .innerJoin(questions, sql`${questions.topicId} = ${topics.id}`)
    .innerJoin(examQuestions, sql`${examQuestions.questionId} = ${questions.id}`)
    .where(inArray(topics.courseId, [...candidateIds]));

  const withBlueprint = await tx
    .selectDistinct({ id: examBlueprintRows.courseId })
    .from(examBlueprintRows)
    .where(inArray(examBlueprintRows.courseId, [...candidateIds]));

  const withSyllabusMap = await tx
    .selectDistinct({ id: syllabusWeekMaps.courseId })
    .from(syllabusWeekMaps)
    .where(inArray(syllabusWeekMaps.courseId, [...candidateIds]));

  const withTemplateRow = await tx
    .selectDistinct({ id: examBlueprintTemplateRows.courseId })
    .from(examBlueprintTemplateRows)
    .where(inArray(examBlueprintTemplateRows.courseId, [...candidateIds]));

  return new Set(
    [...withExamUsage, ...withBlueprint, ...withSyllabusMap, ...withTemplateRow].map((row) => row.id),
  );
}

async function deleteCourses(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  refs: readonly CourseRef[],
): Promise<void> {
  if (refs.length === 0) {
    return;
  }
  const ids = refs.map((ref) => ref.id);
  await tx.delete(generationJobs).where(inArray(generationJobs.courseId, ids));
  await tx.delete(questions).where(
    inArray(
      questions.topicId,
      tx.select({ id: topics.id }).from(topics).where(inArray(topics.courseId, ids)),
    ),
  );
  await tx.delete(topics).where(inArray(topics.courseId, ids));
  await tx.delete(courses).where(inArray(courses.id, ids));
  for (const ref of refs) {
    console.log(`  removed course "${ref.name}"`);
  }
}

export async function purgeTestTaxonomy(): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. UUID-named test-factory courses.
    const junk = await tx
      .select({ id: courses.id, name: courses.name })
      .from(courses)
      .where(sql`${courses.name} ~ ${UUID_FRAGMENT}`);

    // 2. Legacy empty demo courses superseded by the standard syllabus.
    const legacy = await tx
      .select({ id: courses.id, name: courses.name })
      .from(courses)
      .where(inArray(courses.name, [...LEGACY_EMPTY_COURSES]));

    const candidates = [...junk, ...legacy];
    const blocked = await courseIdsWithRealUsage(
      tx,
      candidates.map((c) => c.id),
    );

    const deletable = candidates.filter((c) => !blocked.has(c.id));
    const skipped = candidates.filter((c) => blocked.has(c.id));

    console.log(`Purging ${deletable.length} course(s); skipping ${skipped.length} with real usage.`);
    for (const ref of skipped) {
      console.log(`  kept "${ref.name}" (used in a real exam, blueprint row, or syllabus map)`);
    }

    await deleteCourses(tx, deletable);
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
