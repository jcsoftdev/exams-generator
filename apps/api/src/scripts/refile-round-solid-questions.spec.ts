import { randomUUID } from "node:crypto";
import { Role } from "@exams-generator/shared";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../db/client";
import { courses, questions, topics } from "../db/schema";
import {
  createUserFixture,
  deleteUserFixture,
  ensureGradeLevelsSeeded,
  ensureMigrated,
} from "../test-utils/db-fixtures";
import { refileRoundSolidQuestions } from "./refile-round-solid-questions";

/**
 * Integration test against the real docker-compose Postgres: the script's job
 * IS the topic lookup (same course, `cuerpos-redondos` slug), so mocking the
 * db would test nothing that matters.
 */
describe("refileRoundSolidQuestions", () => {
  const suffix = randomUUID().replace(/-/g, "");
  let courseId: string;
  let planeTopicId: string;
  let solidTopicId: string;
  let authorId: string;
  const createdQuestionIds: string[] = [];

  async function insertQuestion(bodyTypst: string, topicId: string): Promise<string> {
    const [row] = await db
      .insert(questions)
      .values({
        tenantId: null,
        type: "structured",
        topicId,
        difficulty: "easy",
        gradeLevel: "pre",
        status: "approved",
        bodyTypst,
        alternatives: ["1", "2"],
        correctAnswer: "0",
        createdBy: authorId,
      })
      .returning({ id: questions.id });
    createdQuestionIds.push(row!.id);
    return row!.id;
  }

  async function topicOf(id: string): Promise<string> {
    const [row] = await db.select({ topicId: questions.topicId }).from(questions).where(eq(questions.id, id));
    return row!.topicId;
  }

  beforeAll(async () => {
    await ensureMigrated();
    await ensureGradeLevelsSeeded();

    const [course] = await db
      .insert(courses)
      .values({ name: `Geometría M12 ${suffix}`, stage: "preuniversitario" })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [plane] = await db
      .insert(topics)
      .values({ courseId, name: `Triángulos ${suffix}`, slug: "triangulos" })
      .returning({ id: topics.id });
    planeTopicId = plane!.id;

    const [solid] = await db
      .insert(topics)
      .values({ courseId, name: `Cuerpos Redondos ${suffix}`, slug: "cuerpos-redondos" })
      .returning({ id: topics.id });
    solidTopicId = solid!.id;

    const author = await createUserFixture({ tenantId: null, role: Role.ContentEditor });
    authorId = author.id;
  });

  afterAll(async () => {
    await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
    await db.delete(topics).where(inArray(topics.id, [planeTopicId, solidTopicId]));
    await db.delete(courses).where(eq(courses.id, courseId));
    await deleteUserFixture(authorId);
    await pool.end();
  });

  it("moves a cone-volume question out of the triangles topic", async () => {
    const id = await insertQuestion(
      `Los volúmenes de dos conos cuyas bases son iguales están en la relación de 5 a 7 ${suffix}`,
      planeTopicId,
    );

    await refileRoundSolidQuestions();

    expect(await topicOf(id)).toBe(solidTopicId);
  });

  it("leaves the triangle questions where they are", async () => {
    const trig = await insertQuestion(`En un triángulo reduce: abcSenA(CtgB+CtgC) ${suffix}`, planeTopicId);
    const physics = await insertQuestion(
      `Dos esferas caen de una mesa con rapideces de 3 y 8m/s. Calcula la altura ${suffix}`,
      planeTopicId,
    );

    await refileRoundSolidQuestions();

    expect(await topicOf(trig)).toBe(planeTopicId);
    expect(await topicOf(physics)).toBe(planeTopicId);
  });

  it("is idempotent — a second run has nothing left to move", async () => {
    await insertQuestion(`Determine el volumen del cono original ${suffix}`, planeTopicId);

    await refileRoundSolidQuestions();
    const { moved } = await refileRoundSolidQuestions();

    expect(moved).toBe(0);
  });

  it("leaves a question alone when its course has no cuerpos-redondos topic", async () => {
    const [orphanCourse] = await db
      .insert(courses)
      .values({ name: `Geometría sin sólidos ${suffix}`, stage: "colegio" })
      .returning({ id: courses.id });
    const [orphanTopic] = await db
      .insert(topics)
      .values({
        courseId: orphanCourse!.id,
        name: `Triángulos ${suffix} b`,
        slug: "triangulos",
      })
      .returning({ id: topics.id });

    const id = await insertQuestion(`El volumen del cilindro inscrito ${suffix}`, orphanTopic!.id);

    const { skipped } = await refileRoundSolidQuestions();

    expect(skipped).toBeGreaterThanOrEqual(1);
    expect(await topicOf(id)).toBe(orphanTopic!.id);

    await db.delete(questions).where(eq(questions.id, id));
    await db.delete(topics).where(and(eq(topics.id, orphanTopic!.id)));
    await db.delete(courses).where(eq(courses.id, orphanCourse!.id));
  });
});
