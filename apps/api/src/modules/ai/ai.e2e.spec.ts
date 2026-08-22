import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { courses, generationJobs, questions, tenants, topics, users } from "../../db/schema";
import { TokenService } from "../auth/token.service";
import { isTypstAvailableSync } from "../exams/adapters/pdf/test-utils/typst-availability";
import { GeneratedQuestion, QuestionGeneratorPort } from "./domain/ports/question-generator.port";
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
    // Real AI generation never produces byte-identical bodyTypst twice; a
    // scripted fake replaying the SAME fixture across separate tests would
    // otherwise collide with BankService's dedupe check (same bodyTypst,
    // same tenant -> 409) as if it were a re-submission. The comment suffix
    // is invisible in the compiled PDF (Typst line comment).
    return {
      ...(result as GeneratedQuestion),
      bodyTypst: `${(result as GeneratedQuestion).bodyTypst} // ${randomUUID()}`,
    };
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
  let bootstrapModule: TestingModule;
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

    bootstrapModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    const cleanupSteps: Array<[string, () => Promise<unknown>]> = [
      [
        "delete questions",
        async () => {
          if (createdQuestionIds.length > 0) {
            await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
          }
        },
      ],
      // Every draft created via `generateOneDraft()` now goes through the real
      // `/ai/questions/jobs` flow, which persists a `generation_jobs` row
      // FK-referencing `users` (`created_by`) — it must be cleared before
      // `users`, same fix as `ai-jobs.e2e.spec.ts` (Task 4).
      [
        "delete generation jobs",
        () => db.delete(generationJobs).where(inArray(generationJobs.tenantId, [tenantAId, tenantBId])),
      ],
      ["delete users", () => db.delete(users).where(inArray(users.id, [tenantATeacherId, tenantBTeacherId]))],
      ["delete tenants", () => db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))],
      ["delete topics", () => db.delete(topics).where(inArray(topics.id, [topicId]))],
      ["delete courses", () => db.delete(courses).where(inArray(courses.id, [courseId]))],
    ];
    for (const [label, step] of cleanupSteps) {
      try {
        await step();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[afterAll cleanup] "${label}" failed, continuing with remaining steps:`, err);
      }
    }
    await bootstrapModule.close();
    await pool.end();
  });

  async function generateOneDraft(token: string): Promise<string> {
    const created = await request(app.getHttpServer())
      .post("/ai/questions/jobs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        courseId,
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        count: 1,
        withFigure: false,
      })
      .expect(202);

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const res = await request(app.getHttpServer())
        .get(`/ai/questions/jobs/${created.body.id}`)
        .set("Authorization", `Bearer ${token}`);
      if (res.body.status === "completed") {
        return res.body.createdQuestionIds[0];
      }
      if (res.body.status === "failed") {
        throw new Error("Generation job failed unexpectedly in test setup");
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("Generation job did not complete in time");
  }

  it("generate -> draft -> approve: a valid AI question compiles, saves as draft, and can be approved", async () => {
    app = await buildApp(new ScriptedQuestionGeneratorAdapter([VALID_QUESTION]));

    const id = await generateOneDraft(tenantAToken);
    createdQuestionIds.push(id);

    const fetched = await request(app.getHttpServer())
      .get(`/bank/questions/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);

    expect(fetched.body.status).toBe("draft");
    expect(fetched.body.aiGenerated).toBe(true);
    expect(fetched.body.type).toBe("structured");
    expect(fetched.body.bodyTypst).toContain(VALID_QUESTION.bodyTypst);
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

  it("generate -> (invalid Typst markup) -> does NOT save, and the job reports the per-item compile error", async () => {
    app = await buildApp(new ScriptedQuestionGeneratorAdapter([INVALID_TYPST_QUESTION]));

    const created = await request(app.getHttpServer())
      .post("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .send({
        courseId,
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        count: 1,
        withFigure: false,
      })
      .expect(202);

    const deadline = Date.now() + 15000;
    let final:
      | {
          status: string;
          createdCount: number;
          failedCount: number;
          failedItems: { index: number; error: string }[];
        }
      | undefined;
    while (Date.now() < deadline) {
      const res = await request(app.getHttpServer())
        .get(`/ai/questions/jobs/${created.body.id}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      if (res.body.status === "completed") {
        final = res.body;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(final).toBeDefined();
    expect(final!.createdCount).toBe(0);
    expect(final!.failedCount).toBe(1);
    expect(final!.failedItems[0]!.error).toContain("Typst compile failed");

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

    const id = await generateOneDraft(tenantAToken);
    createdQuestionIds.push(id);

    await request(app.getHttpServer())
      .get(`/bank/questions/${id}`)
      .set("Authorization", `Bearer ${tenantBToken}`)
      .expect(404);
  });

  it("approve/reject/edit: a draft can be rejected (deleted) instead of approved", async () => {
    app = await buildApp(new ScriptedQuestionGeneratorAdapter([VALID_QUESTION]));

    const id = await generateOneDraft(tenantAToken);

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

    const id = await generateOneDraft(tenantAToken);
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

    const id = await generateOneDraft(tenantAToken);
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
    expect(stillDraft.body.bodyTypst).toContain(VALID_QUESTION.bodyTypst);
  });

  it("approve/reject/edit: tenant B cannot approve/reject/edit tenant A's draft (404)", async () => {
    app = await buildApp(new ScriptedQuestionGeneratorAdapter([VALID_QUESTION]));

    const id = await generateOneDraft(tenantAToken);
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
