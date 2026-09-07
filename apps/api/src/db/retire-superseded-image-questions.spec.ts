import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "./client";
import { runMigrations } from "./migrate";
import { retireSupersededImageQuestions } from "./retire-superseded-image-questions";
import { courses, examQuestions, exams, questions, tenants, topics, users } from "./schema";

/**
 * Integration cover for the pass that makes shipping a restructured lot to
 * production a plain deploy.
 *
 * The decision half is unit-tested in `plan-image-question-retirement.spec.ts`;
 * what needs a real Postgres is the write half, because the danger lives in the
 * constraints: `exam_questions.question_id` is `ON DELETE NO ACTION`, so a
 * referenced screenshot cannot be deleted before its references move, and
 * `exam_questions` is unique on (exam_id, question_id), so the move itself can
 * collide. Both are silent until a deploy hits them.
 */
describe("retireSupersededImageQuestions", () => {
  const suffix = randomUUID();
  const sourceOf = (label: string) => `Retire Spec ${suffix} — ${label}`;
  let courseId: string;
  let topicId: string;
  let userId: string;
  let tenantId: string;
  const questionIds: string[] = [];
  const examIds: string[] = [];

  const insertQuestion = async (sourceName: string, bodyTypst: string | null): Promise<string> => {
    const [row] = await db
      .insert(questions)
      .values({
        tenantId: null,
        courseId,
        topicId,
        difficulty: Difficulty.Hard,
        gradeLevel: "pre",
        status: "approved",
        sourceName,
        bodyTypst: bodyTypst ?? undefined,
        alternatives: bodyTypst ? ["a", "b"] : undefined,
        correctAnswer: "0",
        aiGenerated: false,
        createdBy: userId,
      })
      .returning({ id: questions.id });
    questionIds.push(row!.id);
    return row!.id;
  };

  const insertExamWith = async (questionId: string, position: number): Promise<string> => {
    const [exam] = await db
      .insert(exams)
      .values({ tenantId, title: `Retire Spec ${suffix} ${position}`, gradeLevel: "pre", createdBy: userId })
      .returning({ id: exams.id });
    examIds.push(exam!.id);
    await db.insert(examQuestions).values({ examId: exam!.id, questionId, position });
    return exam!.id;
  };

  beforeAll(async () => {
    await runMigrations();
    const [course] = await db
      .insert(courses)
      .values({ name: `Retire Spec Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;
    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `Retire Spec Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;
    const [tenant] = await db
      .insert(tenants)
      .values({ name: `Retire Spec Tenant ${suffix}`, slug: `retire-spec-${suffix}` })
      .returning({ id: tenants.id });
    tenantId = tenant!.id;
    const [user] = await db
      .insert(users)
      .values({ email: `retire-${suffix}@test.local`, passwordHash: "x", role: Role.PlatformAdmin })
      .returning({ id: users.id });
    userId = user!.id;
  });

  afterAll(async () => {
    if (examIds.length > 0) {
      await db.delete(examQuestions).where(inArray(examQuestions.examId, examIds));
      await db.delete(exams).where(inArray(exams.id, examIds));
    }
    if (questionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, questionIds));
    }
    await db.delete(topics).where(eq(topics.id, topicId));
    await db.delete(courses).where(eq(courses.id, courseId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("drops the screenshot, moves its exam slot to the text row, and stays put on a re-run", async () => {
    const imageId = await insertQuestion(sourceOf("promovida"), null);
    const textId = await insertQuestion(sourceOf("promovida"), "El enunciado ya legible.");
    const keptId = await insertQuestion(sourceOf("sigue imagen"), null);
    const examId = await insertExamWith(imageId, 1);

    const first = await retireSupersededImageQuestions();
    expect(first.retired).toBeGreaterThanOrEqual(1);
    expect(first.repointed).toBeGreaterThanOrEqual(1);

    const survivors = await db
      .select({ id: questions.id })
      .from(questions)
      .where(inArray(questions.id, [imageId, textId, keptId]));
    expect(survivors.map((row) => row.id).sort()).toEqual([textId, keptId].sort());

    const slots = await db
      .select({ questionId: examQuestions.questionId })
      .from(examQuestions)
      .where(eq(examQuestions.examId, examId));
    expect(slots).toEqual([{ questionId: textId }]);

    // Idempotent: production runs this on every boot, so the second pass has to
    // be a lookup and nothing else.
    const second = await retireSupersededImageQuestions();
    expect(second.retired).toBe(0);
    expect(second.repointed).toBe(0);
  });

  it("drops the duplicate slot instead of colliding when one exam holds both shapes", async () => {
    const imageId = await insertQuestion(sourceOf("duplicada"), null);
    const textId = await insertQuestion(sourceOf("duplicada"), "La misma pregunta, en texto.");
    const [exam] = await db
      .insert(exams)
      .values({ tenantId, title: `Retire Spec ${suffix} dup`, gradeLevel: "pre", createdBy: userId })
      .returning({ id: exams.id });
    examIds.push(exam!.id);
    await db.insert(examQuestions).values([
      { examId: exam!.id, questionId: imageId, position: 1 },
      { examId: exam!.id, questionId: textId, position: 2 },
    ]);

    const result = await retireSupersededImageQuestions();

    expect(result.deduped).toBeGreaterThanOrEqual(1);
    const slots = await db
      .select({ questionId: examQuestions.questionId })
      .from(examQuestions)
      .where(eq(examQuestions.examId, exam!.id));
    expect(slots).toEqual([{ questionId: textId }]);
  });

  it("refuses to pick a winner when two text rows claim one source name", async () => {
    const sourceName = sourceOf("ambigua");
    const imageId = await insertQuestion(sourceName, null);
    await insertQuestion(sourceName, "Una lectura.");
    await insertQuestion(sourceName, "Otra lectura distinta.");

    const result = await retireSupersededImageQuestions();

    expect(result.skipped).toContainEqual({
      sourceName,
      reason: "2 filas de texto comparten este source_name",
    });
    const [survivor] = await db.select({ id: questions.id }).from(questions).where(eq(questions.id, imageId));
    expect(survivor).toBeDefined();
  });
});
