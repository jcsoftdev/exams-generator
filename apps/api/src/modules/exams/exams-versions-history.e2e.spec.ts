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

/** `GET /exams/:examId/versions` (B4) e2e — spec §A.4 acceptance scenarios 1-4. */
describe("GET /exams/:examId/versions (e2e, B4)", () => {
  let app: INestApplication;
  let tokenService: TokenService;
  let storage: StoragePort;

  let courseId: string;
  let tenantAId: string;
  let tenantATeacherId: string;
  let tenantBId: string;
  let tenantBTeacherId: string;
  let tenantAToken: string;
  let tenantBToken: string;

  const createdTopicIds: string[] = [];
  const createdQuestionIds: string[] = [];
  const createdExamIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);
    storage = moduleRef.get(STORAGE_PORT);

    const suffix = randomUUID();

    const [course] = await db.insert(courses).values({ name: `VersionsHistoryE2E Course ${suffix}` }).returning({ id: courses.id });
    courseId = course!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `VersionsHistoryE2E Tenant A ${suffix}`, slug: `versions-history-e2e-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `versions-history-e2e-teacher-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantATeacherId = teacherA!.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `VersionsHistoryE2E Tenant B ${suffix}`, slug: `versions-history-e2e-tenant-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;

    const [teacherB] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `versions-history-e2e-teacher-b-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantBTeacherId = teacherB!.id;

    tenantAToken = tokenService.sign({ sub: tenantATeacherId, tenantId: tenantAId, role: Role.Teacher });
    tenantBToken = tokenService.sign({ sub: tenantBTeacherId, tenantId: tenantBId, role: Role.Teacher });
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
    await db.delete(assets).where(inArray(assets.tenantId, [tenantAId, tenantBId]));
    await db.delete(users).where(inArray(users.id, [tenantATeacherId, tenantBTeacherId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]));
    if (createdTopicIds.length > 0) {
      await db.delete(topics).where(inArray(topics.id, createdTopicIds));
    }
    await db.delete(courses).where(inArray(courses.id, [courseId]));
    await app.close();
    await pool.end();
  });

  async function createApprovedQuestion(topicId: string, gradeLevel: string): Promise<string> {
    const storageKey = `versions-history-e2e/${randomUUID()}`;
    await storage.put(storageKey, TINY_PNG, "image/png");

    const [asset] = await db
      .insert(assets)
      .values({ tenantId: tenantAId, storageKey, mime: "image/png" })
      .returning({ id: assets.id });

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

  function getVersionsRequest(token: string, examId: string) {
    return request(app.getHttpServer()).get(`/exams/${examId}/versions`).set("Authorization", `Bearer ${token}`);
  }

  it("scenario 1: an exam with 3 generated versions -> 3 entries with matching codes + non-empty urls", async () => {
    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `VersionsHistoryE2E Topic ${randomUUID()}` })
      .returning({ id: topics.id });
    const topicId = topic!.id;
    createdTopicIds.push(topicId);
    const gradeLevel = "primaria_1";

    await createApprovedQuestion(topicId, gradeLevel);

    const createResponse = await request(app.getHttpServer())
      .post("/exams")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .send({ title: "History exam", gradeLevel, blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count: 1 }] })
      .expect(201);
    const examId = createResponse.body.id;
    createdExamIds.push(examId);

    await request(app.getHttpServer())
      .post(`/exams/${examId}/versions`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .send({ versionCount: 3 })
      .expect(201);

    const response = await getVersionsRequest(tenantAToken, examId).expect(200);

    expect(response.body).toHaveLength(3);
    expect(response.body.map((v: { code: string }) => v.code)).toEqual(["A", "B", "C"]);
    for (const version of response.body) {
      expect(version.pdfUrl).toEqual(expect.any(String));
      expect(version.pdfUrl.length).toBeGreaterThan(0);
      expect(version.answerSheetUrl).toEqual(expect.any(String));
      expect(version.answerSheetUrl.length).toBeGreaterThan(0);
    }
  });

  it("scenario 2: a nonexistent examId -> 404", async () => {
    await getVersionsRequest(tenantAToken, randomUUID()).expect(404);
  });

  it("scenario 3: a cross-tenant exam -> 404 (not 403 — existence not leaked)", async () => {
    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `VersionsHistoryE2E Topic B ${randomUUID()}` })
      .returning({ id: topics.id });
    const topicId = topic!.id;
    createdTopicIds.push(topicId);
    const gradeLevel = "primaria_2";
    await createApprovedQuestion(topicId, gradeLevel);

    const createResponse = await request(app.getHttpServer())
      .post("/exams")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .send({ title: "Cross-tenant exam", gradeLevel, blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count: 1 }] })
      .expect(201);
    const examId = createResponse.body.id;
    createdExamIds.push(examId);

    await getVersionsRequest(tenantBToken, examId).expect(404);
  });

  it("scenario 4: a ready exam with zero generated versions -> 200 []", async () => {
    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `VersionsHistoryE2E Topic Zero ${randomUUID()}` })
      .returning({ id: topics.id });
    const topicId = topic!.id;
    createdTopicIds.push(topicId);
    const gradeLevel = "primaria_3";
    await createApprovedQuestion(topicId, gradeLevel);

    const createResponse = await request(app.getHttpServer())
      .post("/exams")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .send({ title: "Zero versions exam", gradeLevel, blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count: 1 }] })
      .expect(201);
    const examId = createResponse.body.id;
    createdExamIds.push(examId);

    const response = await getVersionsRequest(tenantAToken, examId).expect(200);

    expect(response.body).toEqual([]);
  });
});
