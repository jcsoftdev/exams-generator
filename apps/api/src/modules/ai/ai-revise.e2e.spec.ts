import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { courses, questions, tenants, topics, users } from "../../db/schema";
import { TokenService } from "../auth/token.service";
import { isTypstAvailableSync } from "../exams/adapters/pdf/test-utils/typst-availability";
import { InMemoryQuestionGeneratorAdapter } from "./adapters/in-memory-question-generator.adapter";
import { QUESTION_GENERATOR_PORT } from "./ai.constants";

/**
 * Full HTTP e2e for `POST /ai/questions/:id/revise` (question editing, Task
 * 4): an AI-assisted edit of an EXISTING bank question that returns a
 * revised, VALIDATED, UNSAVED draft — it never writes to the DB. Overrides
 * `QUESTION_GENERATOR_PORT` with the in-memory fake (mirrors
 * `ai.e2e.spec.ts`) so this suite never depends on `AI_MODEL`/
 * `OPENROUTER_API_KEY`/network access — only the REAL `PdfCompilerPort`
 * (typst CLI) and real Postgres are exercised end-to-end.
 */
const describeIfTypst = isTypstAvailableSync() ? describe : describe.skip;

describeIfTypst("POST /ai/questions/:id/revise (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  let courseId: string;
  let topicId: string;
  let tenantAId: string;
  let tenantATeacherId: string;
  let tenantBId: string;
  let tenantBTeacherId: string;
  let tenantAToken: string;
  let tenantBToken: string;

  const createdQuestionIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(QUESTION_GENERATOR_PORT)
      .useValue(new InMemoryQuestionGeneratorAdapter())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    const suffix = randomUUID();

    const [course] = await db
      .insert(courses)
      .values({ name: `AI Revise E2E Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `AI Revise E2E Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `AI Revise E2E Tenant A ${suffix}`, slug: `ai-revise-e2e-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `ai-revise-e2e-teacher-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantATeacherId = teacherA!.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `AI Revise E2E Tenant B ${suffix}`, slug: `ai-revise-e2e-tenant-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;

    const [teacherB] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `ai-revise-e2e-teacher-b-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantBTeacherId = teacherB!.id;

    tenantAToken = tokenService.sign({ sub: tenantATeacherId, tenantId: tenantAId, role: Role.Teacher });
    tenantBToken = tokenService.sign({ sub: tenantBTeacherId, tenantId: tenantBId, role: Role.Teacher });
  });

  afterAll(async () => {
    const cleanupSteps: Array<[string, () => Promise<unknown>]> = [
      [
        "delete questions",
        async () => {
          if (createdQuestionIds.length > 0) {
            await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
          }
        },
      ],
      ["delete users", () => db.delete(users).where(inArray(users.id, [tenantATeacherId, tenantBTeacherId]))],
      ["delete tenants", () => db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))],
      ["delete topics", () => db.delete(topics).where(inArray(topics.id, [topicId]))],
      ["delete courses", () => db.delete(courses).where(inArray(courses.id, [courseId]))],
      ["close app", () => app.close()],
    ];
    for (const [label, step] of cleanupSteps) {
      try {
        await step();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[afterAll cleanup] "${label}" failed, continuing with remaining steps:`, err);
      }
    }
    await pool.end();
  });

  async function createOwnQuestion(token: string, bodyTypst?: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/bank/questions/structured")
      .set("Authorization", `Bearer ${token}`)
      .send({
        courseId,
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        bodyTypst: bodyTypst ?? `¿Cuánto es $1 + 1$? ${randomUUID()}`,
        alternatives: ["1", "2", "3", "4", "5"],
        correctAnswer: "1",
      })
      .expect(201);
    createdQuestionIds.push(response.body.id);
    return response.body.id;
  }

  function reviseRequest(token: string, id: string) {
    return request(app.getHttpServer())
      .post(`/ai/questions/${id}/revise`)
      .set("Authorization", `Bearer ${token}`);
  }

  it("returns a revised, validated, UNSAVED draft — the persisted question is left untouched", async () => {
    const id = await createOwnQuestion(tenantAToken, "¿Cuánto es $1 + 1$?");

    const response = await reviseRequest(tenantAToken, id).send({ instruction: "más difícil" }).expect(200);

    expect(response.body.bodyTypst).toBe("¿Cuánto es $1 + 1$? (revisado: más difícil)");
    expect(response.body.alternatives).toEqual(["1", "2", "3", "4", "5"]);
    expect(response.body.correctAnswer).toBe("1");

    const fetched = await request(app.getHttpServer())
      .get(`/bank/questions/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);
    expect(fetched.body.bodyTypst).toBe("¿Cuánto es $1 + 1$?");
    expect(fetched.body.alternatives).toEqual(["1", "2", "3", "4", "5"]);
    expect(fetched.body.correctAnswer).toBe("1");
  });

  it("rejects with 400 when the instruction is blank", async () => {
    const id = await createOwnQuestion(tenantAToken);

    await reviseRequest(tenantAToken, id).send({ instruction: "   " }).expect(400);
  });

  it("rejects with 404 when the question doesn't exist", async () => {
    await reviseRequest(tenantAToken, randomUUID()).send({ instruction: "más difícil" }).expect(404);
  });

  it("rejects with 404 when the question belongs to another tenant", async () => {
    const id = await createOwnQuestion(tenantAToken);

    await reviseRequest(tenantBToken, id).send({ instruction: "más difícil" }).expect(404);
  });

  it("rejects with 401 when no Authorization header is sent", async () => {
    const id = await createOwnQuestion(tenantAToken);

    await request(app.getHttpServer())
      .post(`/ai/questions/${id}/revise`)
      .send({ instruction: "más difícil" })
      .expect(401);
  });
});
