import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { assets, courses, questions, tenants, topics, users } from "../../db/schema";
import { TokenService } from "../auth/token.service";

/**
 * `POST /exams/stock/batch` (B1) e2e — spec §A.1 acceptance scenarios.
 * Separate file from `exams.e2e.spec.ts` (already large) mirroring how
 * `exam-ai-structured-flow.e2e.spec.ts` is split out.
 */
describe("POST /exams/stock/batch (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  let courseId: string;
  let staffUserId: string;
  let tenantAId: string;
  let tenantATeacherId: string;

  let staffToken: string;
  let tenantAToken: string;

  const createdTopicIds: string[] = [];
  const createdQuestionIds: string[] = [];
  const createdAssetIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    const suffix = randomUUID();

    const [course] = await db
      .insert(courses)
      .values({ name: `StockBatchE2E Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [staff] = await db
      .insert(users)
      .values({
        tenantId: null,
        email: `stock-batch-e2e-staff-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.ContentEditor,
      })
      .returning({ id: users.id });
    staffUserId = staff!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `StockBatchE2E Tenant A ${suffix}`, slug: `stock-batch-e2e-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `stock-batch-e2e-teacher-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantATeacherId = teacherA!.id;

    staffToken = tokenService.sign({ sub: staffUserId, tenantId: null, role: Role.ContentEditor });
    tenantAToken = tokenService.sign({ sub: tenantATeacherId, tenantId: tenantAId, role: Role.Teacher });
  });

  afterAll(async () => {
    if (createdQuestionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
    }
    if (createdAssetIds.length > 0) {
      await db.delete(assets).where(inArray(assets.id, createdAssetIds));
    }
    await db.delete(users).where(inArray(users.id, [staffUserId, tenantATeacherId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId]));
    if (createdTopicIds.length > 0) {
      await db.delete(topics).where(inArray(topics.id, createdTopicIds));
    }
    await db.delete(courses).where(inArray(courses.id, [courseId]));
    await app.close();
    await pool.end();
  });

  async function createTopic(): Promise<string> {
    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `StockBatchE2E Topic ${randomUUID()}` })
      .returning({ id: topics.id });
    createdTopicIds.push(topic!.id);
    return topic!.id;
  }

  async function createApprovedQuestion(params: {
    tenantId: string | null;
    createdBy: string;
    topicId: string;
    gradeLevel: string;
    difficulty?: Difficulty;
  }): Promise<string> {
    const [asset] = await db
      .insert(assets)
      .values({ tenantId: params.tenantId, storageKey: `stock-batch-e2e/${randomUUID()}`, mime: "image/png" })
      .returning({ id: assets.id });
    createdAssetIds.push(asset!.id);

    const [question] = await db
      .insert(questions)
      .values({
        tenantId: params.tenantId,
        type: "image",
        topicId: params.topicId,
        difficulty: params.difficulty ?? Difficulty.Easy,
        gradeLevel: params.gradeLevel,
        status: "approved",
        imageAssetId: asset!.id,
        correctAnswer: "a",
        createdBy: params.createdBy,
      })
      .returning({ id: questions.id });
    createdQuestionIds.push(question!.id);
    return question!.id;
  }

  function stockBatchRequest(token: string) {
    return request(app.getHttpServer()).post("/exams/stock/batch").set("Authorization", `Bearer ${token}`);
  }

  it("scenario 1: counts 18 tenant-private + 2 central approved questions as available: 20", async () => {
    const topicId = await createTopic();
    const gradeLevel = "secundaria_1";

    for (let i = 0; i < 18; i++) {
      await createApprovedQuestion({
        tenantId: tenantAId,
        createdBy: tenantATeacherId,
        topicId,
        gradeLevel,
        difficulty: Difficulty.Easy,
      });
    }
    for (let i = 0; i < 2; i++) {
      await createApprovedQuestion({ tenantId: null, createdBy: staffUserId, topicId, gradeLevel, difficulty: Difficulty.Easy });
    }

    const response = await stockBatchRequest(tenantAToken)
      .send({ gradeLevel, cells: [{ courseId, topicId, difficulty: Difficulty.Easy }] })
      .expect(200);

    expect(response.body.results).toEqual([
      expect.objectContaining({ courseId, topicId, difficulty: Difficulty.Easy, available: 20 }),
    ]);
  });

  it("scenario 3: a 5-cell batch returns exactly 5 results, order-matched to input", async () => {
    const topicId = await createTopic();
    const gradeLevel = "primaria_1";

    await createApprovedQuestion({ tenantId: tenantAId, createdBy: tenantATeacherId, topicId, gradeLevel, difficulty: Difficulty.Easy });
    await createApprovedQuestion({ tenantId: tenantAId, createdBy: tenantATeacherId, topicId, gradeLevel, difficulty: Difficulty.Medium });
    await createApprovedQuestion({ tenantId: tenantAId, createdBy: tenantATeacherId, topicId, gradeLevel, difficulty: Difficulty.Medium });

    const cells = [
      { courseId, topicId, difficulty: Difficulty.Easy },
      { courseId, topicId, difficulty: Difficulty.Medium },
      { courseId, topicId, difficulty: Difficulty.Hard },
      { courseId, topicId },
      { courseId },
    ];

    const response = await stockBatchRequest(tenantAToken).send({ gradeLevel, cells }).expect(200);

    expect(response.body.results).toHaveLength(5);
    expect(response.body.results.map((r: { available: number }) => r.available)).toEqual([1, 2, 0, 3, 3]);
  });

  it("scenario 6: invalid gradeLevel -> 400, no query runs", async () => {
    await stockBatchRequest(tenantAToken)
      .send({ gradeLevel: "not-a-real-grade", cells: [{ courseId }] })
      .expect(400);
  });

  it("scenario 7: content_editor (null tenant) -> 403", async () => {
    await stockBatchRequest(staffToken)
      .send({ gradeLevel: "primaria_1", cells: [{ courseId }] })
      .expect(403);
  });

  it("scenario 8: no Authorization header -> 401", async () => {
    await request(app.getHttpServer())
      .post("/exams/stock/batch")
      .send({ gradeLevel: "primaria_1", cells: [{ courseId }] })
      .expect(401);
  });
});
