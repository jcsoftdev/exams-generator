import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, inArray } from "drizzle-orm";
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

/** B4 idempotent-regeneration e2e — spec §A.4 acceptance scenarios 5-6. */
describe("POST /exams/:examId/versions — idempotent regeneration (e2e, B4)", () => {
  let app: INestApplication;
  let tokenService: TokenService;
  let storage: StoragePort;

  let courseId: string;
  let tenantAId: string;
  let tenantATeacherId: string;
  let tenantAToken: string;

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

    const [course] = await db.insert(courses).values({ name: `IdempotentE2E Course ${suffix}` }).returning({ id: courses.id });
    courseId = course!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `IdempotentE2E Tenant A ${suffix}`, slug: `idempotent-e2e-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `idempotent-e2e-teacher-a-${suffix}@exams-generator.test`,
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
      ["delete assets", () => db.delete(assets).where(inArray(assets.tenantId, [tenantAId]))],
      ["delete users", () => db.delete(users).where(inArray(users.id, [tenantATeacherId]))],
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

  async function createApprovedQuestion(topicId: string, gradeLevel: string): Promise<string> {
    const storageKey = `idempotent-e2e/${randomUUID()}`;
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

  function versionsRequest(examId: string) {
    return request(app.getHttpServer())
      .post(`/exams/${examId}/versions`)
      .set("Authorization", `Bearer ${tenantAToken}`);
  }

  function getVersionsRequest(examId: string) {
    return request(app.getHttpServer())
      .get(`/exams/${examId}/versions`)
      .set("Authorization", `Bearer ${tenantAToken}`);
  }

  it("scenario 5+6: regenerating with a different versionCount replaces (not appends) prior versions, leaving no duplicate/orphaned rows", async () => {
    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `IdempotentE2E Topic ${randomUUID()}` })
      .returning({ id: topics.id });
    const topicId = topic!.id;
    createdTopicIds.push(topicId);
    const gradeLevel = "primaria_1";

    await createApprovedQuestion(topicId, gradeLevel);

    const createResponse = await request(app.getHttpServer())
      .post("/exams")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .send({ title: "Idempotent exam", gradeLevel, blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count: 1 }] })
      .expect(201);
    const examId = createResponse.body.id;
    createdExamIds.push(examId);

    // First generation: versionCount 2 -> A, B.
    const firstGenerate = await versionsRequest(examId).send({ versionCount: 2 }).expect(201);
    expect(firstGenerate.body.map((v: { code: string }) => v.code).sort()).toEqual(["A", "B"]);

    const firstAssetIds = firstGenerate.body.flatMap((v: { pdfUrl: string; answerSheetUrl: string }) => [v.pdfUrl, v.answerSheetUrl]);

    // Regenerate with a DIFFERENT versionCount (3) -> must succeed, not collide on (examId, code).
    const secondGenerate = await versionsRequest(examId).send({ versionCount: 3 }).expect(201);
    expect(secondGenerate.body.map((v: { code: string }) => v.code).sort()).toEqual(["A", "B", "C"]);

    // GET /versions returns exactly the second call's 3 entries — none of the first call's rows remain.
    const versionsAfter = await getVersionsRequest(examId).expect(200);
    expect(versionsAfter.body).toHaveLength(3);
    expect(versionsAfter.body.map((v: { code: string }) => v.code)).toEqual(["A", "B", "C"]);

    // No orphaned exam_versions rows referencing dead assets: the DB row count for this exam matches exactly 3.
    const versionRows = await db.select().from(examVersions).where(eq(examVersions.examId, examId));
    expect(versionRows).toHaveLength(3);

    // None of the first call's asset-backed URLs are still referenced by any current version row.
    const currentAssetIds = versionsAfter.body.flatMap((v: { pdfUrl: string; answerSheetUrl: string }) => [v.pdfUrl, v.answerSheetUrl]);
    for (const staleUrl of firstAssetIds) {
      expect(currentAssetIds).not.toContain(staleUrl);
    }
  });
});
