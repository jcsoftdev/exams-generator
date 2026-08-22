import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray, eq } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import {
  assets,
  courses,
  examBlueprintRows,
  examQuestions,
  exams,
  questions,
  tenants,
  topics,
  users,
} from "../../db/schema";
import { TokenService } from "../auth/token.service";

/** `POST /exams/preview` (B2) e2e — spec §A.2 acceptance scenarios. */
describe("POST /exams/preview (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  let courseId: string;
  let staffUserId: string;
  let tenantAId: string;
  let tenantATeacherId: string;

  let tenantAToken: string;

  const createdTopicIds: string[] = [];
  const createdQuestionIds: string[] = [];
  const createdAssetIds: string[] = [];
  const createdExamIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    const suffix = randomUUID();

    const [course] = await db
      .insert(courses)
      .values({ name: `PreviewE2E Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [staff] = await db
      .insert(users)
      .values({
        tenantId: null,
        email: `preview-e2e-staff-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.ContentEditor,
      })
      .returning({ id: users.id });
    staffUserId = staff!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `PreviewE2E Tenant A ${suffix}`, slug: `preview-e2e-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `preview-e2e-teacher-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantATeacherId = teacherA!.id;

    tenantAToken = tokenService.sign({ sub: tenantATeacherId, tenantId: tenantAId, role: Role.Teacher });
  });

  afterAll(async () => {
    const cleanupSteps: Array<[string, () => Promise<unknown>]> = [
      [
        "delete exams",
        async () => {
          if (createdExamIds.length > 0) {
            await db.delete(examQuestions).where(inArray(examQuestions.examId, createdExamIds));
            await db.delete(examBlueprintRows).where(inArray(examBlueprintRows.examId, createdExamIds));
            await db.delete(exams).where(inArray(exams.id, createdExamIds));
          }
        },
      ],
      [
        "delete questions",
        async () => {
          if (createdQuestionIds.length > 0) {
            await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
          }
        },
      ],
      [
        "delete assets",
        async () => {
          if (createdAssetIds.length > 0) {
            await db.delete(assets).where(inArray(assets.id, createdAssetIds));
          }
        },
      ],
      ["delete users", () => db.delete(users).where(inArray(users.id, [staffUserId, tenantATeacherId]))],
      ["delete tenants", () => db.delete(tenants).where(inArray(tenants.id, [tenantAId]))],
      [
        "delete topics",
        async () => {
          if (createdTopicIds.length > 0) {
            await db.delete(topics).where(inArray(topics.id, createdTopicIds));
          }
        },
      ],
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

  async function createTopic(): Promise<string> {
    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `PreviewE2E Topic ${randomUUID()}` })
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
      .values({ tenantId: params.tenantId, storageKey: `preview-e2e/${randomUUID()}`, mime: "image/png" })
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

  function previewRequest(token: string) {
    return request(app.getHttpServer()).post("/exams/preview").set("Authorization", `Bearer ${token}`);
  }

  function createExamRequest(token: string) {
    return request(app.getHttpServer()).post("/exams").set("Authorization", `Bearer ${token}`);
  }

  it("scenario 1: a fully-satisfiable blueprint -> shortages: [] and each row's questionIds.length === count", async () => {
    const topicId = await createTopic();
    const gradeLevel = "secundaria_1";
    await createApprovedQuestion({ tenantId: tenantAId, createdBy: tenantATeacherId, topicId, gradeLevel });
    await createApprovedQuestion({ tenantId: tenantAId, createdBy: tenantATeacherId, topicId, gradeLevel });

    const response = await previewRequest(tenantAToken)
      .send({ gradeLevel, blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count: 2 }] })
      .expect(200);

    expect(response.body.shortages).toEqual([]);
    expect(response.body.selections[0].questionIds).toHaveLength(2);
  });

  it("scenario 2: a shortage row -> requested/available in shortages and questionIds has exactly the available ids", async () => {
    const topicId = await createTopic();
    const gradeLevel = "secundaria_1";
    const q1 = await createApprovedQuestion({
      tenantId: tenantAId,
      createdBy: tenantATeacherId,
      topicId,
      gradeLevel,
    });
    const q2 = await createApprovedQuestion({
      tenantId: tenantAId,
      createdBy: tenantATeacherId,
      topicId,
      gradeLevel,
    });
    const q3 = await createApprovedQuestion({
      tenantId: tenantAId,
      createdBy: tenantATeacherId,
      topicId,
      gradeLevel,
    });
    const q4 = await createApprovedQuestion({
      tenantId: tenantAId,
      createdBy: tenantATeacherId,
      topicId,
      gradeLevel,
    });

    const response = await previewRequest(tenantAToken)
      .send({ gradeLevel, blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count: 10 }] })
      .expect(200);

    expect(response.body.shortages).toEqual([
      expect.objectContaining({ rowIndex: 0, requested: 10, available: 4 }),
    ]);
    expect([...response.body.selections[0].questionIds].sort()).toEqual([q1, q2, q3, q4].sort());
  });

  it("scenario 3: availability/shortage math parity with POST /exams on the same bank (ids may differ, counts match)", async () => {
    const topicId = await createTopic();
    const gradeLevel = "secundaria_1";
    await createApprovedQuestion({ tenantId: tenantAId, createdBy: tenantATeacherId, topicId, gradeLevel });
    await createApprovedQuestion({ tenantId: tenantAId, createdBy: tenantATeacherId, topicId, gradeLevel });

    const body = { gradeLevel, blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count: 5 }] };

    const previewResponse = await previewRequest(tenantAToken).send(body).expect(200);
    const createResponse = await createExamRequest(tenantAToken)
      .send({ ...body, title: "Parity check" })
      .expect(422);
    createdExamIds.push(createResponse.body.examId);

    expect(previewResponse.body.shortages[0]).toMatchObject({ requested: 5, available: 2 });
    expect(createResponse.body.shortages[0]).toMatchObject({ requested: 5, available: 2 });
  });

  it("scenario 4: a valid preview call inserts no exams/examBlueprintRows/examQuestions rows", async () => {
    const topicId = await createTopic();
    const gradeLevel = "secundaria_1";
    await createApprovedQuestion({ tenantId: tenantAId, createdBy: tenantATeacherId, topicId, gradeLevel });

    // Counts are scoped to THIS SUITE'S tenant: other e2e suites run in
    // parallel jest workers against the same dev Postgres and insert their
    // own exams rows constantly — a global before/after count races with
    // them. Any row the preview endpoint wrongly inserted would belong to
    // the requesting tenant, so the tenant scope loses no signal.
    const countSuiteRows = async () => {
      const examRows = await db.select({ id: exams.id }).from(exams).where(eq(exams.tenantId, tenantAId));
      const blueprintRows = await db
        .select({ id: examBlueprintRows.id })
        .from(examBlueprintRows)
        .innerJoin(exams, eq(examBlueprintRows.examId, exams.id))
        .where(eq(exams.tenantId, tenantAId));
      const questionRows = await db
        .select({ id: examQuestions.id })
        .from(examQuestions)
        .innerJoin(exams, eq(examQuestions.examId, exams.id))
        .where(eq(exams.tenantId, tenantAId));
      return { examRows, blueprintRows, questionRows };
    };

    const before = await countSuiteRows();

    await previewRequest(tenantAToken)
      .send({ gradeLevel, blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count: 1 }] })
      .expect(200);

    const after = await countSuiteRows();

    expect(after.examRows).toHaveLength(before.examRows.length);
    expect(after.blueprintRows).toHaveLength(before.blueprintRows.length);
    expect(after.questionRows).toHaveLength(before.questionRows.length);
  });

  it("scenario 5: invalid gradeLevel -> 400 before any DB read", async () => {
    await previewRequest(tenantAToken)
      .send({ gradeLevel: "not-a-real-grade", blueprint: [{ courseId, count: 1 }] })
      .expect(400);
  });

  it("scenario 6: teacher-shaped token with null tenantId -> 403 (defensive guard)", async () => {
    const contentEditorToken = tokenService.sign({
      sub: staffUserId,
      tenantId: null,
      role: Role.ContentEditor,
    });

    await previewRequest(contentEditorToken)
      .send({ gradeLevel: "primaria_1", blueprint: [{ courseId, count: 1 }] })
      .expect(403);
  });
});
