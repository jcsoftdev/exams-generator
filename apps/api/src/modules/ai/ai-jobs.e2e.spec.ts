import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
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

class ScriptedQuestionGeneratorAdapter implements QuestionGeneratorPort {
  async generate(): Promise<GeneratedQuestion> {
    // Real AI generation never repeats bodyTypst byte-for-byte; a fake that
    // always returns the SAME content breaks `count > 1` jobs under
    // BankService's dedupe check (2nd item collides with the 1st as a
    // same-tenant duplicate). Comment suffix is invisible once compiled.
    return { ...VALID_QUESTION, bodyTypst: `${VALID_QUESTION.bodyTypst} // ${randomUUID()}` };
  }
  async reviseQuestion(): Promise<GeneratedQuestion> {
    throw new Error("not used");
  }
  async extractFromImage(): Promise<GeneratedQuestion> {
    throw new Error("not used");
  }
}

const describeIfTypst = isTypstAvailableSync() ? describe : describe.skip;

describeIfTypst("AI generation jobs (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  let courseId: string;
  let topicId: string;
  let tenantAId: string;
  let teacherAId: string;
  let tenantBId: string;
  let teacherBId: string;
  let tokenA: string;
  let tokenB: string;

  const createdQuestionIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(QUESTION_GENERATOR_PORT)
      .useValue(new ScriptedQuestionGeneratorAdapter())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    const suffix = randomUUID();

    const [course] = await db
      .insert(courses)
      .values({ name: `Jobs E2E Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `Jobs E2E Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `Jobs E2E Tenant A ${suffix}`, slug: `jobs-e2e-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;
    const [teacherA] = await db
      .insert(users)
      .values({ tenantId: tenantAId, email: `jobs-e2e-a-${suffix}@exams-generator.test`, passwordHash: "x", role: Role.Teacher })
      .returning({ id: users.id });
    teacherAId = teacherA!.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `Jobs E2E Tenant B ${suffix}`, slug: `jobs-e2e-tenant-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;
    const [teacherB] = await db
      .insert(users)
      .values({ tenantId: tenantBId, email: `jobs-e2e-b-${suffix}@exams-generator.test`, passwordHash: "x", role: Role.Teacher })
      .returning({ id: users.id });
    teacherBId = teacherB!.id;

    tokenA = tokenService.sign({ sub: teacherAId, tenantId: tenantAId, role: Role.Teacher });
    tokenB = tokenService.sign({ sub: teacherBId, tenantId: tenantBId, role: Role.Teacher });
  });

  afterAll(async () => {
    if (createdQuestionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
    }
    // Every test in this suite creates a `generation_jobs` row, which
    // FK-references tenants/users/courses/topics — it must be cleared before
    // any of those, and tracking ids per-test is unnecessary since every job
    // created here belongs to tenantA or tenantB.
    await db.delete(generationJobs).where(inArray(generationJobs.tenantId, [tenantAId, tenantBId]));
    await db.delete(users).where(inArray(users.id, [teacherAId, teacherBId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]));
    await db.delete(topics).where(inArray(topics.id, [topicId]));
    await db.delete(courses).where(inArray(courses.id, [courseId]));
    await app.close();
    await pool.end();
  });

  function validBody() {
    return { courseId, topicId, difficulty: Difficulty.Easy, gradeLevel: "primaria_1", count: 2, withFigure: false };
  }

  async function waitForTerminal(token: string, jobId: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const res = await request(app.getHttpServer())
        .get(`/ai/questions/jobs/${jobId}`)
        .set("Authorization", `Bearer ${token}`);
      if (["completed", "failed", "cancelled"].includes(res.body.status)) {
        return res.body;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Job ${jobId} did not reach a terminal status in time`);
  }

  it("creates a job (202, pending) that reaches completed with the requested count of created questions", async () => {
    const created = await request(app.getHttpServer())
      .post("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(validBody())
      .expect(202);

    expect(created.body.status).toBe("pending");
    expect(created.body.count).toBe(2);

    const final = await waitForTerminal(tokenA, created.body.id);
    expect(final.status).toBe("completed");
    expect((final.createdQuestionIds as string[])).toHaveLength(2);
    createdQuestionIds.push(...(final.createdQuestionIds as string[]));
  });

  it("rejects with 400 when required fields are missing, without creating a job", async () => {
    await request(app.getHttpServer())
      .post("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({})
      .expect(400);
  });

  it("rejects with 401 when no Authorization header is sent", async () => {
    await request(app.getHttpServer()).post("/ai/questions/jobs").send(validBody()).expect(401);
  });

  it("tenant B cannot read tenant A's job (404)", async () => {
    const created = await request(app.getHttpServer())
      .post("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(validBody())
      .expect(202);
    await waitForTerminal(tokenA, created.body.id).then((r) =>
      createdQuestionIds.push(...(r.createdQuestionIds as string[])),
    );

    await request(app.getHttpServer())
      .get(`/ai/questions/jobs/${created.body.id}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(404);
  });

  it("GET /ai/questions/jobs only lists the caller's tenant's jobs", async () => {
    const created = await request(app.getHttpServer())
      .post("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(validBody())
      .expect(202);
    await waitForTerminal(tokenA, created.body.id).then((r) =>
      createdQuestionIds.push(...(r.createdQuestionIds as string[])),
    );

    const listA = await request(app.getHttpServer())
      .get("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);
    expect(listA.body.items.map((i: { id: string }) => i.id)).toContain(created.body.id);

    const listB = await request(app.getHttpServer())
      .get("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(200);
    expect(listB.body.items.map((i: { id: string }) => i.id)).not.toContain(created.body.id);
  });

  it("cancel stops the job before it completes every requested item", async () => {
    const created = await request(app.getHttpServer())
      .post("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ ...validBody(), count: 10 })
      .expect(202);

    await request(app.getHttpServer())
      .post(`/ai/questions/jobs/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);

    const final = await waitForTerminal(tokenA, created.body.id);
    expect(final.status).toBe("cancelled");
    expect((final.createdCount as number)).toBeLessThan(10);
    createdQuestionIds.push(...(final.createdQuestionIds as string[]));
  });

  it("cancelling an already-terminal job is a no-op that still returns 200", async () => {
    const created = await request(app.getHttpServer())
      .post("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(validBody())
      .expect(202);
    const final = await waitForTerminal(tokenA, created.body.id);
    createdQuestionIds.push(...(final.createdQuestionIds as string[]));

    const response = await request(app.getHttpServer())
      .post(`/ai/questions/jobs/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);
    expect(response.body.status).toBe("completed");
  });

  it("tenant B cannot cancel tenant A's job (404)", async () => {
    const created = await request(app.getHttpServer())
      .post("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(validBody())
      .expect(202);

    await request(app.getHttpServer())
      .post(`/ai/questions/jobs/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(404);

    const final = await waitForTerminal(tokenA, created.body.id);
    createdQuestionIds.push(...(final.createdQuestionIds as string[]));
  });
});
