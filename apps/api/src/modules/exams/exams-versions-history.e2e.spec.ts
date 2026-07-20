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
    const cleanupSteps: Array<[string, () => Promise<unknown>]> = [
      [
        "delete exams",
        async () => {
          if (createdExamIds.length > 0) {
            await db.delete(examVersions).where(inArray(examVersions.examId, createdExamIds));
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
      ["delete assets", () => db.delete(assets).where(inArray(assets.tenantId, [tenantAId, tenantBId]))],
      ["delete users", () => db.delete(users).where(inArray(users.id, [tenantATeacherId, tenantBTeacherId]))],
      ["delete tenants", () => db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))],
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

  describe("GET /exams/:examId/versions/zip (N1)", () => {
    async function createReadyExamWithVersions(gradeLevel: string, versionCount: number): Promise<string> {
      const [topic] = await db
        .insert(topics)
        .values({ courseId, name: `VersionsZipE2E Topic ${randomUUID()}` })
        .returning({ id: topics.id });
      const topicId = topic!.id;
      createdTopicIds.push(topicId);
      await createApprovedQuestion(topicId, gradeLevel);

      const createResponse = await request(app.getHttpServer())
        .post("/exams")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({ title: "Zip exam", gradeLevel, blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count: 1 }] })
        .expect(201);
      const examId = createResponse.body.id;
      createdExamIds.push(examId);

      if (versionCount > 0) {
        await request(app.getHttpServer())
          .post(`/exams/${examId}/versions`)
          .set("Authorization", `Bearer ${tenantAToken}`)
          .send({ versionCount })
          .expect(201);
      }
      return examId;
    }

    function zipRequest(token: string, examId: string) {
      return request(app.getHttpServer())
        .get(`/exams/${examId}/versions/zip`)
        .set("Authorization", `Bearer ${token}`)
        .responseType("blob");
    }

    it("scenario 1: an exam with 2 versions -> 200 application/zip whose bytes are a real ZIP naming each form", async () => {
      const examId = await createReadyExamWithVersions("secundaria_1", 2);

      const response = await zipRequest(tenantAToken, examId).expect(200);

      expect(response.headers["content-type"]).toContain("application/zip");
      const body = response.body as Buffer;
      expect(Buffer.isBuffer(body)).toBe(true);
      // ZIP local-file-header magic "PK\x03\x04".
      expect(body.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      for (const name of ["Examen-A.pdf", "Claves-A.pdf", "Examen-B.pdf", "Claves-B.pdf"]) {
        expect(body.includes(Buffer.from(name))).toBe(true);
      }
    });

    it("scenario 2: a cross-tenant exam -> 404 (existence not leaked)", async () => {
      const examId = await createReadyExamWithVersions("secundaria_2", 2);

      await zipRequest(tenantBToken, examId).expect(404);
    });

    it("scenario 3: a ready exam with zero generated versions -> 409 (nothing to download)", async () => {
      const examId = await createReadyExamWithVersions("secundaria_3", 0);

      await zipRequest(tenantAToken, examId).expect(409);
    });

    it("scenario 4: a nonexistent examId -> 404", async () => {
      await zipRequest(tenantAToken, randomUUID()).expect(404);
    });
  });
});
