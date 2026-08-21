import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { Role } from "@exams-generator/shared";
import { db, pool } from "../db/client";
import { questions } from "../db/schema";
import {
  createTenantFixture,
  createUserFixture,
  deleteTenantFixture,
  deleteTopicAndCourseFixture,
  deleteUserFixture,
  ensureGradeLevelsSeeded,
  ensureMigrated,
  ensureTopicFixture,
  type TenantFixture,
  type TopicFixture,
} from "../test-utils/db-fixtures";
import { stripSeededSolutionTails } from "./strip-seeded-solution-tails";

/**
 * Integration test against the real docker-compose Postgres — the SQL
 * pre-filter is half of what this script does, so mocking the db would test
 * the uninteresting half.
 */
describe("stripSeededSolutionTails", () => {
  let topic: TopicFixture;
  let authorId: string;
  let tenant: TenantFixture;
  let tenantAuthorId: string;
  const createdQuestionIds: string[] = [];

  async function insertQuestion(params: {
    alternatives: string[];
    tenantId?: string | null;
  }): Promise<string> {
    const [row] = await db
      .insert(questions)
      .values({
        tenantId: params.tenantId ?? null,
        type: "structured",
        topicId: topic.id,
        difficulty: "easy",
        gradeLevel: "pre",
        status: "approved",
        bodyTypst: `Pregunta ${randomUUID()}`,
        alternatives: params.alternatives,
        correctAnswer: "0",
        createdBy: params.tenantId ? tenantAuthorId : authorId,
      })
      .returning({ id: questions.id });
    createdQuestionIds.push(row!.id);
    return row!.id;
  }

  async function alternativesOf(id: string): Promise<string[]> {
    const [row] = await db
      .select({ alternatives: questions.alternatives })
      .from(questions)
      .where(eq(questions.id, id));
    return row!.alternatives as string[];
  }

  beforeAll(async () => {
    await ensureMigrated();
    await ensureGradeLevelsSeeded();
    topic = await ensureTopicFixture();
    const author = await createUserFixture({ tenantId: null, role: Role.ContentEditor });
    authorId = author.id;
    tenant = await createTenantFixture();
    const tenantAuthor = await createUserFixture({ tenantId: tenant.id, role: Role.Teacher });
    tenantAuthorId = tenantAuthor.id;
  });

  afterAll(async () => {
    await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
    await deleteTopicAndCourseFixture(topic);
    await deleteUserFixture(authorId);
    await deleteUserFixture(tenantAuthorId);
    await deleteTenantFixture(tenant.id);
    await pool.end();
  });

  it("cuts the answer key off a central-bank alternative", async () => {
    const id = await insertQuestion({
      alternatives: ["Agustín Gamarra", 'Manuel Prado y Ugarteche. Rpta.: "A" Ver respuesta correcta'],
    });

    const { updated } = await stripSeededSolutionTails();

    expect(updated).toBeGreaterThanOrEqual(1);
    expect(await alternativesOf(id)).toEqual(["Agustín Gamarra", "Manuel Prado y Ugarteche."]);
  });

  it("is idempotent — a second pass rewrites nothing it already cleaned", async () => {
    const id = await insertQuestion({ alternatives: ["12", "15 2da. Prueba Examen de Admisión 2020-1"] });

    await stripSeededSolutionTails();
    const afterFirst = await alternativesOf(id);
    const { updated } = await stripSeededSolutionTails();

    expect(afterFirst).toEqual(["12", "15"]);
    expect(updated).toBe(0);
  });

  it("leaves a tenant's own question alone", async () => {
    // Central bank only: if a teacher typed "Rpta." into an option, that is theirs.
    const own = ["Sí", 'No. Rpta.: "A"'];
    const id = await insertQuestion({ alternatives: own, tenantId: tenant.id });

    await stripSeededSolutionTails();

    expect(await alternativesOf(id)).toEqual(own);
  });
});
