import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray, or } from "drizzle-orm";
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

/** Minimal valid 1x1 transparent PNG — real image bytes so a full
 * shuffle -> Typst compile -> MinIO upload round trip can actually succeed
 * end-to-end in the ownership positive-control test below (not just a
 * placeholder buffer that would fail image decoding). */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

/**
 * Full HTTP e2e for the `exams` module — release-gate requirement from the
 * design doc's Testing section (§8): "un tenant NUNCA ve preguntas privadas
 * de otro" must also hold for exam *question selection* (automatic
 * blueprint fill), and exam *ownership* must be enforced on every mutating
 * endpoint (`replace`, `confirm`, `versions`) — a tenant must never be able
 * to operate on another tenant's exam.
 *
 * `bank.e2e.spec.ts` already covers `GET /bank/questions` (list) and
 * `GET /bank/questions/:id` isolation exhaustively — this file does NOT
 * duplicate that; it covers the exams-module-specific surface only.
 */
describe("Exams module (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;
  let storage: StoragePort;

  let courseId: string;
  let staffUserId: string;
  let tenantAId: string;
  let tenantATeacherId: string;
  let tenantBId: string;
  let tenantBTeacherId: string;

  let staffToken: string;
  let tenantAToken: string;
  let tenantBToken: string;
  /** Global role (design doc §2) — used ONLY to set up a real tenant logo via `POST /tenants/:id/logo` (that endpoint requires platform_admin/school_admin, `staffToken`'s content_editor role is deliberately excluded from it). */
  let platformAdminToken: string;

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

    const [course] = await db
      .insert(courses)
      .values({ name: `ExamsE2E Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [staff] = await db
      .insert(users)
      .values({
        tenantId: null,
        email: `exams-e2e-staff-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.ContentEditor,
      })
      .returning({ id: users.id });
    staffUserId = staff!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `ExamsE2E Tenant A ${suffix}`, slug: `exams-e2e-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `exams-e2e-teacher-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantATeacherId = teacherA!.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `ExamsE2E Tenant B ${suffix}`, slug: `exams-e2e-tenant-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;

    const [teacherB] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `exams-e2e-teacher-b-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantBTeacherId = teacherB!.id;

    staffToken = tokenService.sign({ sub: staffUserId, tenantId: null, role: Role.ContentEditor });
    tenantAToken = tokenService.sign({ sub: tenantATeacherId, tenantId: tenantAId, role: Role.Teacher });
    tenantBToken = tokenService.sign({ sub: tenantBTeacherId, tenantId: tenantBId, role: Role.Teacher });
    platformAdminToken = tokenService.sign({ sub: staffUserId, tenantId: null, role: Role.PlatformAdmin });
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
    // Null out the tenant logo FK first — the real-logo setup above makes
    // `tenants.logo_asset_id` point at an `assets` row, and the sweep below
    // deletes that same row; without this, the delete violates the FK.
    await db.update(tenants).set({ logoAssetId: null }).where(inArray(tenants.id, [tenantAId, tenantBId]));
    // Also sweep by tenantId: `generateVersions()` creates its own PDF/
    // answer-key asset rows (repository.createAsset) whose ids aren't
    // tracked in `createdAssetIds`.
    await db
      .delete(assets)
      .where(
        or(
          createdAssetIds.length > 0 ? inArray(assets.id, createdAssetIds) : undefined,
          inArray(assets.tenantId, [tenantAId, tenantBId]),
        ),
      );
    await db.delete(users).where(inArray(users.id, [staffUserId, tenantATeacherId, tenantBTeacherId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]));
    if (createdTopicIds.length > 0) {
      await db.delete(topics).where(inArray(topics.id, createdTopicIds));
    }
    await db.delete(courses).where(inArray(courses.id, [courseId]));
    await app.close();
    await pool.end();
  });

  /** Fresh topic per scenario so pool-size assertions can't be contaminated by sibling tests. */
  async function createTopic(): Promise<string> {
    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `ExamsE2E Topic ${randomUUID()}` })
      .returning({ id: topics.id });
    createdTopicIds.push(topic!.id);
    return topic!.id;
  }

  /** Approved question inserted directly (mirrors `exams.repository.spec.ts`'s fixture convention). */
  async function createApprovedQuestion(params: {
    tenantId: string | null;
    createdBy: string;
    topicId: string;
    gradeLevel: string;
    difficulty?: Difficulty;
    /** Uploads a real (tiny) PNG to storage under the asset's key — needed
     * only when a test exercises actual PDF generation end-to-end. */
    withRealImage?: boolean;
  }): Promise<string> {
    const storageKey = `exams-e2e/${randomUUID()}`;
    if (params.withRealImage) {
      await storage.put(storageKey, TINY_PNG, "image/png");
    }

    const [asset] = await db
      .insert(assets)
      .values({ tenantId: params.tenantId, storageKey, mime: "image/png" })
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

  function createExamRequest(token: string) {
    return request(app.getHttpServer()).post("/exams").set("Authorization", `Bearer ${token}`);
  }

  function replaceRequest(token: string, examId: string, questionId: string) {
    return request(app.getHttpServer())
      .post(`/exams/${examId}/questions/${questionId}/replace`)
      .set("Authorization", `Bearer ${token}`);
  }

  function confirmRequest(token: string, examId: string) {
    return request(app.getHttpServer())
      .post(`/exams/${examId}/confirm`)
      .set("Authorization", `Bearer ${token}`);
  }

  function versionsRequest(token: string, examId: string) {
    return request(app.getHttpServer())
      .post(`/exams/${examId}/versions`)
      .set("Authorization", `Bearer ${token}`);
  }

  function getExamRequest(token: string, examId: string) {
    return request(app.getHttpServer())
      .get(`/exams/${examId}`)
      .set("Authorization", `Bearer ${token}`);
  }

  describe("POST /exams — blueprint selection never draws from another tenant's private pool", () => {
    it("fills the row only from central + own-tenant approved questions, never another tenant's private ones", async () => {
      const topicId = await createTopic();
      const gradeLevel = "primaria_1";

      const centralId = await createApprovedQuestion({
        tenantId: null,
        createdBy: staffUserId,
        topicId,
        gradeLevel,
      });
      const aPrivateId = await createApprovedQuestion({
        tenantId: tenantAId,
        createdBy: tenantATeacherId,
        topicId,
        gradeLevel,
      });
      // Decoys: two tenant-B-private approved questions matching the exact
      // same criteria. If the pool ever leaked cross-tenant, the selector
      // would have 4 candidates for a row asking for 2 and this test's
      // exact-set assertion below would fail.
      await createApprovedQuestion({ tenantId: tenantBId, createdBy: tenantBTeacherId, topicId, gradeLevel });
      await createApprovedQuestion({ tenantId: tenantBId, createdBy: tenantBTeacherId, topicId, gradeLevel });

      const response = await createExamRequest(tenantAToken)
        .send({
          title: "Simulacro Tenant A",
          gradeLevel,
          blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count: 2 }],
        })
        .expect(201);
      createdExamIds.push(response.body.id);

      expect(response.body.status).toBe("draft");
      expect([...response.body.selectedQuestionIds].sort()).toEqual([centralId, aPrivateId].sort());
    });

    it("reports a stock shortage (not a silent cross-tenant leak) when the tenant-visible pool can't fill the row", async () => {
      const topicId = await createTopic();
      const gradeLevel = "primaria_1";

      // Only 1 question visible to tenant A (central); 2 more exist but are
      // private to tenant B. A correct implementation must report a
      // shortage of "1 available" — NOT silently pull in tenant B's rows to
      // satisfy the count.
      const centralId = await createApprovedQuestion({
        tenantId: null,
        createdBy: staffUserId,
        topicId,
        gradeLevel,
      });
      await createApprovedQuestion({ tenantId: tenantBId, createdBy: tenantBTeacherId, topicId, gradeLevel });
      await createApprovedQuestion({ tenantId: tenantBId, createdBy: tenantBTeacherId, topicId, gradeLevel });

      const response = await createExamRequest(tenantAToken)
        .send({
          title: "Simulacro Tenant A Shortage",
          gradeLevel,
          blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count: 3 }],
        })
        .expect(422);

      createdExamIds.push(response.body.examId);
      expect(response.body.shortages).toHaveLength(1);
      expect(response.body.shortages[0]).toMatchObject({ requested: 3, available: 1 });
      void centralId; // available count above proves only the central question counted
    });

    it("central (tenantId=null) questions are visible to every tenant's exam pool", async () => {
      const topicId = await createTopic();
      const gradeLevel = "primaria_1";

      const centralId = await createApprovedQuestion({
        tenantId: null,
        createdBy: staffUserId,
        topicId,
        gradeLevel,
      });

      const forA = await createExamRequest(tenantAToken)
        .send({
          title: "Central visible to A",
          gradeLevel,
          blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count: 1 }],
        })
        .expect(201);
      createdExamIds.push(forA.body.id);

      const forB = await createExamRequest(tenantBToken)
        .send({
          title: "Central visible to B",
          gradeLevel,
          blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count: 1 }],
        })
        .expect(201);
      createdExamIds.push(forB.body.id);

      expect(forA.body.selectedQuestionIds).toEqual([centralId]);
      expect(forB.body.selectedQuestionIds).toEqual([centralId]);
    });
  });

  describe("Cross-tenant exam ownership — replace/confirm/versions must never operate on another tenant's exam", () => {
    let examBId: string;
    let examBQuestionId: string;
    let spareCandidateId: string;

    beforeAll(async () => {
      const topicId = await createTopic();
      const gradeLevel = "primaria_1";

      // Real logo for tenant B — exercises `materializeLogo()` +
      // `#image(...)` embedding end-to-end (smoke capstone, PARALLEL-TODO
      // "Smoke e2e completo ... con tenant real + logo"). A prior version of
      // this test never set a logo, so the versions-generation positive
      // control below never actually compiled the logo-embedding branch.
      await request(app.getHttpServer())
        .post(`/tenants/${tenantBId}/logo`)
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .attach("file", TINY_PNG, { filename: "logo.png", contentType: "image/png" })
        .expect(201);

      // Two approved questions matching the row so a same-tenant reroll has
      // a real alternative available — proves a 200 for the owner is a
      // genuine success, not a false negative from an empty pool.
      const central = await createApprovedQuestion({
        tenantId: null,
        createdBy: staffUserId,
        topicId,
        gradeLevel,
        withRealImage: true,
      });
      const bPrivate = await createApprovedQuestion({
        tenantId: tenantBId,
        createdBy: tenantBTeacherId,
        topicId,
        gradeLevel,
        withRealImage: true,
      });

      const created = await createExamRequest(tenantBToken)
        .send({
          title: "Tenant B's own exam",
          gradeLevel,
          blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count: 1 }],
        })
        .expect(201);
      createdExamIds.push(created.body.id);

      examBId = created.body.id;
      examBQuestionId = created.body.selectedQuestionIds[0];
      spareCandidateId = examBQuestionId === central ? bPrivate : central;
    });

    it("POST .../replace — tenant A gets 404 on tenant B's exam", async () => {
      await replaceRequest(tenantAToken, examBId, examBQuestionId).send({ mode: "reroll" }).expect(404);
    });

    it("POST .../replace — positive control: tenant B (owner) can replace on its own exam", async () => {
      const response = await replaceRequest(tenantBToken, examBId, examBQuestionId)
        .send({ mode: "reroll" })
        .expect(201);

      expect(response.body).toMatchObject({ examId: examBId, oldQuestionId: examBQuestionId });
      expect(response.body.newQuestionId).toBe(spareCandidateId);
    });

    it("POST .../confirm — tenant A gets 404 on tenant B's exam", async () => {
      await confirmRequest(tenantAToken, examBId).expect(404);
    });

    it("POST .../confirm — positive control: tenant B (owner) can confirm its own exam", async () => {
      const response = await confirmRequest(tenantBToken, examBId).expect(201);
      expect(response.body).toEqual({ id: examBId, status: "ready" });
    });

    it("POST .../versions — tenant A gets 404 on tenant B's exam (ownership checked before anything else)", async () => {
      await versionsRequest(tenantAToken, examBId).send({ versionCount: 1 }).expect(404);
    });

    it("POST .../versions — positive control: owner tenant B can fully generate K>=2 versions, real PDFs land in MinIO (with tenant B's logo embedded), presigned URLs returned (smoke capstone)", async () => {
      const response = await versionsRequest(tenantBToken, examBId).send({ versionCount: 2 }).expect(201);

      expect(response.body).toHaveLength(2);
      expect(response.body.map((v: { code: string }) => v.code).sort()).toEqual(["A", "B"]);

      for (const version of response.body as { code: string; pdfUrl: string; answerSheetUrl: string }[]) {
        expect(version.pdfUrl).toEqual(expect.any(String));
        expect(version.answerSheetUrl).toEqual(expect.any(String));

        // The URLs are presigned MinIO GETs (real StoragePort, not
        // in-memory) — pull the real bytes back out to prove the compiled
        // PDF actually landed in the bucket (compiling with a real tenant
        // logo — `materializeLogo()` — did not throw).
        const pdfKey = `exams/${examBId}/versions/${version.code}/exam.pdf`;
        const answerKeyKey = `exams/${examBId}/versions/${version.code}/answer-key.pdf`;
        const pdfBytes = await storage.get(pdfKey);
        const answerBytes = await storage.get(answerKeyKey);

        expect(pdfBytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
        expect(answerBytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
      }
    });

    it("GET /exams/:examId — tenant A gets 404 on tenant B's exam", async () => {
      await getExamRequest(tenantAToken, examBId).expect(404);
    });

    it("GET /exams/:examId — positive control: tenant B (owner) can fetch its own exam detail with selected questions", async () => {
      const response = await getExamRequest(tenantBToken, examBId).expect(200);

      expect(response.body).toMatchObject({ id: examBId, title: "Tenant B's own exam", status: "ready" });
      expect(response.body.questions).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "image" })]),
      );
      expect(response.body.questions[0]).toHaveProperty("position");
      expect(response.body.questions[0]).toHaveProperty("correctAnswer");
    });

    it("GET /exams/:examId — 404 for a non-existent exam id", async () => {
      await getExamRequest(tenantBToken, randomUUID()).expect(404);
    });
  });

  it("POST /exams — rejects with 401 when no Authorization header is sent", async () => {
    await request(app.getHttpServer()).post("/exams").send({}).expect(401);
  });

  it("POST /exams — rejects with 403 for a platform-staff role (content_editor is not teacher/school_admin)", async () => {
    await createExamRequest(staffToken).send({}).expect(403);
  });
});
