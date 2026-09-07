import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "./client";
import { planImageQuestionRetirement } from "./plan-image-question-retirement";
import { examQuestions, questions } from "./schema";

/**
 * Drops the whole-question screenshots that a restructured lot has replaced
 * with text, and hands their exam references to the text row.
 *
 * Runs on every boot, like the other backfills around it, and is idempotent:
 * once a lot is retired there is no image row left to pair, so the steady-state
 * cost is two selects and no write. That is what makes shipping a restructured
 * lot to production a plain deploy — the seeder inserts the new text rows and
 * this clears the ones they superseded, with no manual step on the server.
 *
 * The repoint happens BEFORE the delete on purpose: `exam_questions.question_id`
 * is `ON DELETE NO ACTION`, so a referenced screenshot cannot simply be removed,
 * and an exam a teacher already built keeps working — it now prints the readable
 * version of the same question instead of a picture of somebody's answer sheet.
 */
export async function retireSupersededImageQuestions(): Promise<{
  retired: number;
  repointed: number;
  /** Slots dropped because that exam already held the text version too. */
  deduped: number;
  skipped: readonly { sourceName: string; reason: string }[];
}> {
  const central = and(isNull(questions.tenantId), isNotNull(questions.sourceName));
  const [imageRows, textRows] = await Promise.all([
    db
      .select({ id: questions.id, sourceName: questions.sourceName })
      .from(questions)
      .where(and(central, isNull(questions.bodyTypst))),
    db
      .select({ id: questions.id, sourceName: questions.sourceName })
      .from(questions)
      .where(and(central, isNotNull(questions.bodyTypst))),
  ]);

  const plan = planImageQuestionRetirement({ imageRows, textRows });
  if (plan.retire.length === 0) {
    return { retired: 0, repointed: 0, deduped: 0, skipped: plan.skipped };
  }

  let repointed = 0;
  let deduped = 0;
  await db.transaction(async (tx) => {
    for (const { imageId, textId } of plan.retire) {
      const references = await tx
        .select({ id: examQuestions.id, examId: examQuestions.examId })
        .from(examQuestions)
        .where(eq(examQuestions.questionId, imageId));
      for (const reference of references) {
        // `exam_questions` is unique on (exam_id, question_id). An exam that
        // somehow holds BOTH shapes of one question cannot take the repoint —
        // it would collide — and it does not want two copies printed either,
        // so the screenshot's slot goes away and the text one stays.
        const [alreadyHasText] = await tx
          .select({ id: examQuestions.id })
          .from(examQuestions)
          .where(and(eq(examQuestions.examId, reference.examId), eq(examQuestions.questionId, textId)));
        if (alreadyHasText) {
          await tx.delete(examQuestions).where(eq(examQuestions.id, reference.id));
          deduped += 1;
          continue;
        }
        await tx.update(examQuestions).set({ questionId: textId }).where(eq(examQuestions.id, reference.id));
        repointed += 1;
      }
    }
    // Chunked: `IN (...)` with a few thousand parameters trips the driver, the
    // same reason `verify-lot-seeding.ts` pages its lookups.
    const ids = plan.retire.map((pair) => pair.imageId);
    for (let i = 0; i < ids.length; i += 200) {
      await tx.delete(questions).where(inArray(questions.id, ids.slice(i, i + 200)));
    }
  });

  return { retired: plan.retire.length, repointed, deduped, skipped: plan.skipped };
}
