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
import { TokenService } from "../auth/token.service";

/**
 * Full HTTP e2e — real Nest app, real Postgres, real MinIO, and the real
 * `typst` CLI (release-gate requirement, design doc §8: e2e of flows by
 * role + tenant isolation). Covers the whole design doc §5.3/§5.4 flow:
 * create -> auto-select -> (shortage 422) -> replace -> confirm -> generate
 * versions+PDFs, PLUS the explicit "a tenant NEVER sees another tenant's
 * private questions" gate for exam question selection specifically.
 */
describe("Exams module (e2e)", () => {
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

  const createdExamIds: string[] = [];
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
      .values({ name: `E2E Exams Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `E2E Exams Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `E2E Exams Tenant A ${suffix}`, slug: `e2e-exams-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `e2e-exams-teacher-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantATeacherId = teacherA!.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `E2E Exams Tenant B ${suffix}`, slug: `e2e-exams-tenant-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;

    const [teacherB] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `e2e-exams-teacher-b-${suffix}@exams-generator.test`,
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
    if (createdAssetIds.length > 0) {
      await db.delete(assets).where(inArray(assets.id, createdAssetIds));
    }
    // Version generation also creates its own PDF/answer-sheet assets
    // (row.pdfAssetId/answerSheetAssetId) that this suite never tracks by
    // id — sweep anything still tied to the test tenants before they're deleted.
    await db.delete(assets).where(inArray(assets.tenantId, [tenantAId, tenantBId]));
    await db.delete(users).where(inArray(users.id, [tenantATeacherId, tenantBTeacherId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]));
    await db.delete(topics).where(inArray(topics.id, [topicId]));
    await db.delete(courses).where(inArray(courses.id, [courseId]));
    await app.close();
    await pool.end();
  });

  async function seedApprovedQuestion(params: {
    tenantId: string | null;
    createdBy: string;
    gradeLevel: string;
    difficulty?: Difficulty;
  }): Promise<string> {
    // 1x1 transparent PNG — small, valid image bytes typst can actually decode.
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );

    const storageKey = `e2e-exams/${randomUUID()}.png`;
    const [asset] = await db
      .insert(assets)
      .values({ tenantId: params.tenantId, storageKey, mime: "image/png" })
      .returning({ id: assets.id });
    createdAssetIds.push(asset!.id);

    // Upload real bytes to MinIO too — version generation downloads by storageKey.
    const storageProviderModule: typeof import("../bank/storage-provider") = await import(
      "../bank/storage-provider"
    );
    const storage = storageProviderModule.resolveStorageAdapter();
    await storage.put(storageKey, pngBytes, "image/png");

    const [question] = await db
      .insert(questions)
      .values({
        tenantId: params.tenantId,
        type: "image",
        topicId,
        difficulty: params.difficulty ?? Difficulty.Easy,
        gradeLevel: params.gradeLevel,
        status: "approved",
        imageAssetId: asset!.id,
        correctAnswer: "b",
        createdBy: params.createdBy,
      })
      .returning({ id: questions.id });
    createdQuestionIds.push(question!.id);
    return question!.id;
  }

  function authed(token: string) {
    return {
      post: (url: string) => request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`),
    };
  }

  it("rejects unauthenticated requests with 401", async () => {
    await request(app.getHttpServer()).post("/exams").send({}).expect(401);
  });

  it("returns 422 with row-specific detail when the blueprint can't be filled, and does NOT select a sibling tenant's private questions", async () => {
    // Tenant B has a matching question, but tenant A's pool must never see it.
    await seedApprovedQuestion({ tenantId: tenantBId, createdBy: tenantBTeacherId, gradeLevel: "secundaria_1" });

    const response = await authed(tenantAToken)
      .post("/exams")
      .send({
        title: "Shortage exam",
        gradeLevel: "secundaria_1",
        blueprint: [{ courseId, count: 3 }],
      })
      .expect(422);

    expect(response.body.examId).toBeDefined();
    createdExamIds.push(response.body.examId);
    expect(response.body.shortages).toHaveLength(1);
    expect(response.body.shortages[0]).toMatchObject({ requested: 3, available: 0 });
  });

  it("full flow: create (auto-select) -> replace -> confirm -> generate versions with real PDFs", async () => {
    // Fixed catalog value (grade_levels is a small seeded catalog, not
    // insertable per-test) — safe to reuse across tests because the
    // blueprint filters by this suite's OWN unique `courseId`, isolating
    // it from any other data already seeded at this grade level.
    const gradeLevel = "primaria_2";
    // Seed enough approved central questions for a 2-row blueprint, plus one
    // extra so reroll has somewhere to go.
    const q1 = await seedApprovedQuestion({ tenantId: null, createdBy: tenantATeacherId, gradeLevel });
    const q2 = await seedApprovedQuestion({ tenantId: null, createdBy: tenantATeacherId, gradeLevel });
    const q3 = await seedApprovedQuestion({ tenantId: null, createdBy: tenantATeacherId, gradeLevel });

    const createResponse = await authed(tenantAToken)
      .post("/exams")
      .send({
        title: "Simulacro E2E",
        gradeLevel,
        blueprint: [{ courseId, count: 2 }],
      })
      .expect(201);

    const examId = createResponse.body.id;
    createdExamIds.push(examId);
    expect(createResponse.body.status).toBe("draft");
    expect(createResponse.body.selectedQuestionIds).toHaveLength(2);
    const selectedIds: string[] = createResponse.body.selectedQuestionIds;
    expect(new Set(selectedIds).size).toBe(2);
    for (const id of selectedIds) {
      expect([q1, q2, q3]).toContain(id);
    }

    // Reroll the first selected question — must land on the remaining
    // unused candidate from {q1,q2,q3}.
    const questionToReplace = selectedIds[0]!;
    const replaceResponse = await authed(tenantAToken)
      .post(`/exams/${examId}/questions/${questionToReplace}/replace`)
      .send({ mode: "reroll" })
      .expect(201);

    expect(replaceResponse.body.oldQuestionId).toBe(questionToReplace);
    expect(replaceResponse.body.newQuestionId).not.toBe(questionToReplace);
    expect([q1, q2, q3]).toContain(replaceResponse.body.newQuestionId);

    const finalSelectedIds = [replaceResponse.body.newQuestionId, selectedIds[1]];

    // Confirming from the wrong tenant must 404 (never leak existence).
    await authed(tenantBToken).post(`/exams/${examId}/confirm`).send({}).expect(404);

    await authed(tenantAToken).post(`/exams/${examId}/confirm`).send({}).expect(201);

    // Replacing after confirmation is locked.
    await authed(tenantAToken)
      .post(`/exams/${examId}/questions/${replaceResponse.body.newQuestionId}/replace`)
      .send({ mode: "reroll" })
      .expect(409);

    const versionsResponse = await authed(tenantAToken)
      .post(`/exams/${examId}/versions`)
      .send({ versionCount: 2 })
      .expect(201);

    expect(versionsResponse.body).toHaveLength(2);
    for (const version of versionsResponse.body) {
      expect(version.code).toMatch(/^[A-Z]+$/);
      expect(typeof version.pdfUrl).toBe("string");
      expect(typeof version.answerSheetUrl).toBe("string");
    }

    const versionRows = await db.select().from(examVersions).where(inArray(examVersions.examId, [examId]));
    expect(versionRows).toHaveLength(2);
    for (const row of versionRows) {
      expect(row.pdfAssetId).toBeTruthy();
      expect(row.answerSheetAssetId).toBeTruthy();
      expect(Array.isArray(row.questionOrder)).toBe(true);
      expect((row.questionOrder as string[]).sort()).toEqual([...finalSelectedIds].sort());
    }
  }, 30000);
});
