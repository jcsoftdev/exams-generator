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
import {
  GeneratedQuestion,
  QuestionGeneratorPort,
} from "./domain/ports/question-generator.port";
import { QUESTION_GENERATOR_PORT } from "./ai.constants";

const VALID_QUESTION: GeneratedQuestion = {
  bodyTypst: "¿Cuál es el resultado de $1 + 1$?",
  alternatives: ["1", "2", "3", "4", "5"],
  correctAnswer: "b",
};

const INVALID_TYPST_QUESTION: GeneratedQuestion = {
  // Reliably fails `typst compile`: calling an undefined function.
  bodyTypst: "#this_function_does_not_exist_zzz()",
  alternatives: ["1", "2", "3", "4", "5"],
  correctAnswer: "a",
};

/** Test double: returns a scripted sequence of responses, one per call. */
class ScriptedQuestionGeneratorAdapter implements QuestionGeneratorPort {
  private callCount = 0;

  constructor(private readonly script: readonly GeneratedQuestion[]) {}

  async generate(): Promise<GeneratedQuestion> {
    const result = this.script[this.callCount] ?? this.script[this.script.length - 1];
    this.callCount += 1;
    return result as GeneratedQuestion;
  }

  async reviseQuestion(): Promise<GeneratedQuestion> {
    throw new Error("ScriptedQuestionGeneratorAdapter.reviseQuestion is not used in this suite");
  }

  async extractFromImage(): Promise<GeneratedQuestion> {
    throw new Error("ScriptedQuestionGeneratorAdapter.extractFromImage is not used in this suite");
  }
}

/**
 * Full HTTP e2e for the Lane D3 AI workflow (design doc §5.2): AI generation
 * NEVER publishes directly to the bank — every generated question that
 * compiles lands as `status='draft'`, and only the human approve/reject/edit
 * endpoints (bank module) change that. `QUESTION_GENERATOR_PORT` is
 * overridden with a scripted fake so this suite never depends on
 * `AI_MODEL`/`OPENROUTER_API_KEY`/network access — only the REAL
 * `PdfCompilerPort` (typst CLI) and real Postgres are exercised end-to-end.
 */
const describeIfTypst = isTypstAvailableSync() ? describe : describe.skip;

describeIfTypst("AI generation workflow (e2e)", () => {
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

  async function buildApp(generator: QuestionGeneratorPort): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(QUESTION_GENERATOR_PORT)
      .useValue(generator)
      .compile();
    const nestApp = moduleRef.createNestApplication();
    await nestApp.init();
    return nestApp;
  }

  beforeAll(async () => {
    await runMigrations();

    const bootstrapModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    tokenService = bootstrapModule.get(TokenService);

    const suffix = randomUUID();

    const [course] = await db
      .insert(courses)
      .values({ name: `AI E2E Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `AI E2E Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `AI E2E Tenant A ${suffix}`, slug: `ai-e2e-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `ai-e2e-teacher-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantATeacherId = teacherA!.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `AI E2E Tenant B ${suffix}`, slug: `ai-e2e-tenant-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;

    const [teacherB] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `ai-e2e-teacher-b-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantBTeacherId = teacherB!.id;

    tenantAToken = tokenService.sign({ sub: tenantATeacherId, tenantId: tenantAId, role: Role.Teacher });
    tenantBToken = tokenService.sign({ sub: tenantBTeacherId, tenantId: tenantBId, role: Role.Teacher });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  afterAll(async () => {
    if (createdQuestionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
    }
    await db.delete(users).where(inArray(users.id, [tenantATeacherId, tenantBTeacherId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]));
    await db.delete(topics).where(inArray(topics.id, [topicId]));
    await db.delete(courses).where(inArray(courses.id, [courseId]));
    await pool.end();
  });

  function generateRequest(token: string) {
    return request(app.getHttpServer())
      .post("/ai/questions/generate")
      .set("Authorization", `Bearer ${token}`);
  }

  it("generate -> draft -> approve: a valid AI question compiles, saves as draft, and can be approved", async () => {
    app = await buildApp(new ScriptedQuestionGeneratorAdapter([VALID_QUESTION]));

    const response = await generateRequest(tenantAToken)
      .send({
        courseId,
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        count: 1,
      })
      .expect(201);

    expect(response.body.created).toHaveLength(1);
    expect(response.body.failed).toHaveLength(0);
    const id = response.body.created[0].id;
    createdQuestionIds.push(id);

    const fetched = await request(app.getHttpServer())
      .get(`/bank/questions/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);

    expect(fetched.body.status).toBe("draft");
    expect(fetched.body.aiGenerated).toBe(true);
    expect(fetched.body.type).toBe("structured");
    expect(fetched.body.bodyTypst).toBe(VALID_QUESTION.bodyTypst);
    // "b" -> 0-based index "1"
    expect(fetched.body.correctAnswer).toBe("1");

    const drafts = await request(app.getHttpServer())
      .get("/bank/questions")
      .query({ status: "draft" })
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);
    expect(drafts.body.map((q: { id: string }) => q.id)).toContain(id);

    await request(app.getHttpServer())
      .post(`/bank/questions/${id}/approve`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(201);

    const approved = await request(app.getHttpServer())
      .get(`/bank/questions/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);
    expect(approved.body.status).toBe("approved");
  });

  it("generate -> (invalid Typst markup) -> does NOT save, and reports the per-item compile error", async () => {
    app = await buildApp(new ScriptedQuestionGeneratorAdapter([INVALID_TYPST_QUESTION]));

    const response = await generateRequest(tenantAToken)
      .send({
        courseId,
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        count: 1,
      })
      .expect(201);

    expect(response.body.created).toHaveLength(0);
    expect(response.body.failed).toHaveLength(1);
    expect(response.body.failed[0].index).toBe(0);
    expect(response.body.failed[0].error).toContain("Typst compile failed");

    const drafts = await request(app.getHttpServer())
      .get("/bank/questions")
      .query({ status: "draft", topicId })
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);
    // Nothing new was persisted for this scenario.
    expect(drafts.body).toHaveLength(0);
  });

  it("persists the requester's tenant on the generated draft — never visible to another tenant", async () => {
    app = await buildApp(new ScriptedQuestionGeneratorAdapter([VALID_QUESTION]));

    const response = await generateRequest(tenantAToken)
      .send({ courseId, topicId, difficulty: Difficulty.Medium, gradeLevel: "secundaria_1", count: 1 })
      .expect(201);
    const id = response.body.created[0].id;
    createdQuestionIds.push(id);

    await request(app.getHttpServer())
      .get(`/bank/questions/${id}`)
      .set("Authorization", `Bearer ${tenantBToken}`)
      .expect(404);
  });

  it("rejects with 400 when required fields are missing", async () => {
    app = await buildApp(new ScriptedQuestionGeneratorAdapter([VALID_QUESTION]));

    await generateRequest(tenantAToken).send({}).expect(400);
  });

  it("rejects with 401 when no Authorization header is sent", async () => {
    app = await buildApp(new ScriptedQuestionGeneratorAdapter([VALID_QUESTION]));

    await request(app.getHttpServer()).post("/ai/questions/generate").send({}).expect(401);
  });

  it("approve/reject/edit: a draft can be rejected (deleted) instead of approved", async () => {
    app = await buildApp(new ScriptedQuestionGeneratorAdapter([VALID_QUESTION]));

    const response = await generateRequest(tenantAToken)
      .send({ courseId, topicId, difficulty: Difficulty.Easy, gradeLevel: "primaria_1", count: 1 })
      .expect(201);
    const id = response.body.created[0].id;

    await request(app.getHttpServer())
      .post(`/bank/questions/${id}/reject`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .get(`/bank/questions/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(404);
  });

  it("approve/reject/edit: a human can edit a draft's content before approving, recompiling the preview", async () => {
    app = await buildApp(new ScriptedQuestionGeneratorAdapter([VALID_QUESTION]));

    const response = await generateRequest(tenantAToken)
      .send({ courseId, topicId, difficulty: Difficulty.Easy, gradeLevel: "primaria_1", count: 1 })
      .expect(201);
    const id = response.body.created[0].id;
    createdQuestionIds.push(id);

    const edited = await request(app.getHttpServer())
      .patch(`/bank/questions/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .send({ bodyTypst: "¿Cuál es el resultado de $2 + 2$?" })
      .expect(200);

    expect(edited.body.bodyTypst).toBe("¿Cuál es el resultado de $2 + 2$?");
    expect(edited.body.status).toBe("draft");

    await request(app.getHttpServer())
      .post(`/bank/questions/${id}/approve`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(201);
  });

  it("approve/reject/edit: an edit with invalid Typst markup is rejected (400) and NOT persisted", async () => {
    app = await buildApp(new ScriptedQuestionGeneratorAdapter([VALID_QUESTION]));

    const response = await generateRequest(tenantAToken)
      .send({ courseId, topicId, difficulty: Difficulty.Easy, gradeLevel: "primaria_1", count: 1 })
      .expect(201);
    const id = response.body.created[0].id;
    createdQuestionIds.push(id);

    await request(app.getHttpServer())
      .patch(`/bank/questions/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .send({ bodyTypst: INVALID_TYPST_QUESTION.bodyTypst })
      .expect(400);

    const stillDraft = await request(app.getHttpServer())
      .get(`/bank/questions/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);
    expect(stillDraft.body.bodyTypst).toBe(VALID_QUESTION.bodyTypst);
  });

  it("approve/reject/edit: tenant B cannot approve/reject/edit tenant A's draft (404)", async () => {
    app = await buildApp(new ScriptedQuestionGeneratorAdapter([VALID_QUESTION]));

    const response = await generateRequest(tenantAToken)
      .send({ courseId, topicId, difficulty: Difficulty.Easy, gradeLevel: "primaria_1", count: 1 })
      .expect(201);
    const id = response.body.created[0].id;
    createdQuestionIds.push(id);

    await request(app.getHttpServer())
      .post(`/bank/questions/${id}/approve`)
      .set("Authorization", `Bearer ${tenantBToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/bank/questions/${id}/reject`)
      .set("Authorization", `Bearer ${tenantBToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/bank/questions/${id}`)
      .set("Authorization", `Bearer ${tenantBToken}`)
      .send({ bodyTypst: "hacked" })
      .expect(404);
  });
});
