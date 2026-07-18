import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
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
  examVersions,
  questions,
  tenants,
  topics,
  users,
} from "../../db/schema";
import { STORAGE_PORT } from "../bank/bank.constants";
import { TokenService } from "../auth/token.service";
import { StoragePort } from "./domain/ports/storage.port";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

/**
 * B3 auto-confirm + B3-R6 regression e2e — spec §A.3 acceptance scenarios.
 */
describe("POST /exams/:examId/versions — auto-confirm on generate (e2e, B3)", () => {
  let app: INestApplication;
  let tokenService: TokenService;
  let storage: StoragePort;

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
    storage = moduleRef.get(STORAGE_PORT);

    const suffix = randomUUID();

    const [course] = await db.insert(courses).values({ name: `AutoConfirmE2E Course ${suffix}` }).returning({ id: courses.id });
    courseId = course!.id;

    const [staff] = await db
      .insert(users)
      .values({
        tenantId: null,
        email: `auto-confirm-e2e-staff-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.ContentEditor,
      })
      .returning({ id: users.id });
    staffUserId = staff!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `AutoConfirmE2E Tenant A ${suffix}`, slug: `auto-confirm-e2e-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `auto-confirm-e2e-teacher-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantATeacherId = teacherA!.id;

    tenantAToken = tokenService.sign({ sub: tenantATeacherId, tenantId: tenantAId, role: Role.Teacher });
  });

  afterAll(async () => {
    if (createdExamIds.length > 0) {
      await db.delete(examVersions).where(inArray(examVersions.examId, createdExamIds));
      await db.delete(examQuestions).where(inArray(examQuestions.examId, createdExamIds));
      await db.delete(examBlueprintRows).where(inArray(examBlueprintRows.examId, createdExamIds));
      await db.delete(exams).where(inArray(exams.id, createdExamIds));
    }
    if (createdQuestionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
    }
    await db.delete(assets).where(inArray(assets.tenantId, [tenantAId]));
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
      .values({ courseId, name: `AutoConfirmE2E Topic ${randomUUID()}` })
      .returning({ id: topics.id });
    createdTopicIds.push(topic!.id);
    return topic!.id;
  }

  async function createApprovedQuestion(topicId: string, gradeLevel: string): Promise<string> {
    const storageKey = `auto-confirm-e2e/${randomUUID()}`;
    await storage.put(storageKey, TINY_PNG, "image/png");

    const [asset] = await db
      .insert(assets)
      .values({ tenantId: tenantAId, storageKey, mime: "image/png" })
      .returning({ id: assets.id });
    createdAssetIds.push(asset!.id);

    const [question] = await db
      .insert(questions)
      .values({
        tenantId: tenantAId,
        type: "image",
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel,
        status: "approved",
        imageAssetId: asset!.id,
        correctAnswer: "a",
        createdBy: tenantATeacherId,
      })
      .returning({ id: questions.id });
    createdQuestionIds.push(question!.id);
    return question!.id;
  }

  async function createDraftExam(topicId: string, gradeLevel: string, count: number): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/exams")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .send({ title: "Auto-confirm exam", gradeLevel, blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count }] })
      .expect(201);
    createdExamIds.push(response.body.id);
    return response.body.id;
  }

  function versionsRequest(examId: string) {
    return request(app.getHttpServer())
      .post(`/exams/${examId}/versions`)
      .set("Authorization", `Bearer ${tenantAToken}`);
  }

  function getExamRequest(examId: string) {
    return request(app.getHttpServer()).get(`/exams/${examId}`).set("Authorization", `Bearer ${tenantAToken}`);
  }

  function replaceRequest(examId: string, questionId: string) {
    return request(app.getHttpServer())
      .post(`/exams/${examId}/questions/${questionId}/replace`)
      .set("Authorization", `Bearer ${tenantAToken}`);
  }

  it("scenario 1 + 5: a draft exam with selected questions auto-confirms on POST /versions — no separate /confirm call needed, status ends ready", async () => {
    const topicId = await createTopic();
    const gradeLevel = "primaria_1";
    await createApprovedQuestion(topicId, gradeLevel);
    await createApprovedQuestion(topicId, gradeLevel);
    await createApprovedQuestion(topicId, gradeLevel);
    await createApprovedQuestion(topicId, gradeLevel);
    await createApprovedQuestion(topicId, gradeLevel);
    await createApprovedQuestion(topicId, gradeLevel);
    const examId = await createDraftExam(topicId, gradeLevel, 6);

    const beforeGenerate = await getExamRequest(examId).expect(200);
    expect(beforeGenerate.body.status).toBe("draft");

    const generateResponse = await versionsRequest(examId).send({ versionCount: 2 }).expect(201);
    expect(generateResponse.body).toHaveLength(2);

    const afterGenerate = await getExamRequest(examId).expect(200);
    expect(afterGenerate.body.status).toBe("ready");
  });

  it("scenario 2: a draft exam with ZERO selected questions -> 409, status remains draft", async () => {
    const topicId = await createTopic();
    const gradeLevel = "primaria_2";
    // Create an exam requesting more than the bank has, so createExam 422s
    // and leaves the exam in draft with zero selected questions.
    const response = await request(app.getHttpServer())
      .post("/exams")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .send({
        title: "Empty selection exam",
        gradeLevel,
        blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count: 3 }],
      })
      .expect(422);
    createdExamIds.push(response.body.examId);
    const examId = response.body.examId;

    await versionsRequest(examId).send({ versionCount: 1 }).expect(409);

    const detail = await getExamRequest(examId).expect(200);
    expect(detail.body.status).toBe("draft");
  });

  it("scenario 3: a ready exam generating versions again succeeds unchanged, no confirm side effect", async () => {
    const topicId = await createTopic();
    const gradeLevel = "primaria_3";
    await createApprovedQuestion(topicId, gradeLevel);
    const examId = await createDraftExam(topicId, gradeLevel, 1);

    await versionsRequest(examId).send({ versionCount: 1 }).expect(201);
    const afterFirst = await getExamRequest(examId).expect(200);
    expect(afterFirst.body.status).toBe("ready");

    // Second call on the already-ready exam succeeds without error.
    await versionsRequest(examId).send({ versionCount: 1 }).expect(201);
    const afterSecond = await getExamRequest(examId).expect(200);
    expect(afterSecond.body.status).toBe("ready");
  });

  it("B3-R6 regression: POST .../replace still 409s on a ready exam generated via auto-confirm", async () => {
    const topicId = await createTopic();
    const gradeLevel = "primaria_4";
    const q1 = await createApprovedQuestion(topicId, gradeLevel);
    void q1;
    await createApprovedQuestion(topicId, gradeLevel);
    const examId = await createDraftExam(topicId, gradeLevel, 1);

    await versionsRequest(examId).send({ versionCount: 1 }).expect(201);

    const detail = await getExamRequest(examId).expect(200);
    const selectedQuestionId = detail.body.questions[0].id;

    await replaceRequest(examId, selectedQuestionId).send({ mode: "reroll" }).expect(409);
  });
});
