import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, pool } from "../db/client";
import { questions, topics } from "../db/schema";
import { isRoundSolidQuestion } from "../modules/bank/domain/is-round-solid-question";

/** The topic these belong to; every course that has plane topics also seeds this one. */
const TARGET_SLUG = "cuerpos-redondos";

/** Topics that are about plane figures — where a solid-of-revolution problem is out of place. */
const PLANE_TOPIC_SLUGS = [
  "triangulos",
  "circunferencia",
  "poligonos-y-cuadrilateros",
  "areas-de-regiones-planas",
  "segmentos-y-angulos",
  "congruencia-y-semejanza",
  "proporcionalidad-y-relaciones-metricas",
];

/**
 * Moves solid-of-revolution questions out of the plane-geometry topics they
 * were filed under (audit 2026-08-20, M12). The blueprint selects by topic, so
 * a teacher who asks for triangle questions was being handed a cone-volume
 * problem.
 *
 * Scope is small ON PURPOSE, and measuring is what set it. Under
 * Geometría → Triángulos, 3 of 317 questions are genuinely off-topic; the 25
 * the audit read as misfiled trigonometry are triangle problems that use trig,
 * which is not the same thing. Bank-wide the precise rule matches 4 rows. This
 * script fixes those; it does not pretend to audit the classification of 65k
 * questions, which needs judgment per question, not a regex.
 *
 * The move keeps the question's course AND grade level — only the topic
 * changes — and a question whose course has no `cuerpos-redondos` topic at its
 * grade is left alone and reported rather than forced somewhere.
 */
export async function refileRoundSolidQuestions(): Promise<{
  moved: number;
  skipped: number;
  candidates: number;
}> {
  const candidates = await db
    .select({
      id: questions.id,
      bodyTypst: questions.bodyTypst,
      courseId: topics.courseId,
      gradeLevel: topics.gradeLevel,
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .where(
      and(
        isNull(questions.tenantId),
        sql`${questions.bodyTypst} IS NOT NULL`,
        inArray(topics.slug, PLANE_TOPIC_SLUGS),
      ),
    );

  const misfiled = candidates.filter((row) => isRoundSolidQuestion(row.bodyTypst ?? ""));

  let moved = 0;
  let skipped = 0;

  for (const row of misfiled) {
    const [target] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(
        and(
          eq(topics.courseId, row.courseId),
          eq(topics.slug, TARGET_SLUG),
          row.gradeLevel === null
            ? isNull(topics.gradeLevel)
            : eq(topics.gradeLevel, row.gradeLevel),
        ),
      );

    if (!target) {
      skipped++;
      continue;
    }

    await db.update(questions).set({ topicId: target.id }).where(eq(questions.id, row.id));
    moved++;
  }

  return { moved, skipped, candidates: misfiled.length };
}

/* istanbul ignore next -- CLI entrypoint, run manually after review, not from the boot seed */
if (require.main === module) {
  refileRoundSolidQuestions()
    .then(({ moved, skipped, candidates }) => {
      console.log(`[refile-round-solids] moved ${moved}, skipped ${skipped} of ${candidates} matches.`);
    })
    .catch((error: unknown) => {
      console.error("[refile-round-solids] failed:", error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
