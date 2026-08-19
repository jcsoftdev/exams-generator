import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db } from "../../db/client";
import {
  assets,
  examBlueprintRows,
  examQuestions,
  examVersionJobs,
  exams,
  examVersions,
  generationJobs,
  questions,
} from "../../db/schema";
import {
  closeDbPool,
  createTenantFixture,
  createUserFixture,
  deleteTenantFixture,
  deleteTopicAndCourseFixture,
  deleteUserFixture,
  ensureGradeLevelsSeeded,
  ensureMigrated,
  ensureTopicFixture,
  TenantFixture,
  TopicFixture,
  UserFixture,
} from "../../test-utils/db-fixtures";
import { STORAGE_PORT } from "../bank/bank.constants";
import { StoragePort } from "../exams/domain/ports/storage.port";

/** Minimal valid 1x1 transparent PNG — real bytes, so `GET /assets/:id` can actually stream something for the positive control. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const GRADE_LEVEL = "secundaria_1";

/**
 * Cross-tenant visibility audit (whole API surface).
 *
 * Every previous audit pass ran INSIDE a single tenant; this file is the
 * permanent regression net for the other axis: for every route that takes a
 * resource identifier, can a user of school A read, mutate or delete a row
 * belonging to school B?
 *
 * The contract asserted here is "403 or 404, never 200 with B's data". A 404
 * that hides existence is a perfectly good answer — the tests therefore
 * accept the exact status the route already returns rather than imposing one
 * shape, but they never accept a 2xx carrying another tenant's row.
 *
 * Each `describe` block opens with a POSITIVE CONTROL: the same request made
 * by tenant B's own user, asserted to succeed. Without it a green "A gets
 * 404" proves nothing — a typo'd id or a route that 404s for everybody would
 * look identical to real scoping.
 *
 * Central bank rows (`questions.tenantId === null`) are SHARED BY DESIGN —
 * every school reads them, only platform staff writes them. The central
 * question read below is asserted to return 200 on purpose: that is correct
 * behaviour, not a leak.
 *
 * Three different mechanisms scope this API and they are NOT
 * interchangeable:
 *  - `TenantGuard` — compares the JWT `tenantId` against a ROUTE PARAM that
 *    is itself a tenant id (`/tenants/:id`). 403 on mismatch.
 *  - Service/repository `where tenant_id = ...` — everything else
 *    (`exams`, `bank`, `assets`, `ai`, `users`). 404 on mismatch.
 *  - `canManageQuestionTenant` — the data-dependent central-vs-tenant write
 *    rule for bank questions, which runs AFTER the row was already fetched
 *    through the visibility filter.
 */
describe("Cross-tenant visibility (e2e)", () => {
  let app: INestApplication;
  let storage: StoragePort;

  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let schoolAdminA: UserFixture;
  let teacherA: UserFixture;
  let schoolAdminB: UserFixture;
  let teacherB: UserFixture;

  let tokenSchoolAdminA: string;
  let tokenTeacherA: string;
  let tokenSchoolAdminB: string;
  let tokenTeacherB: string;

  let topic: TopicFixture;

  /** Tenant B's private rows — the targets tenant A reaches for. */
  let assetBId: string;
  let questionBId: string;
  let draftQuestionBId: string;
  let centralQuestionId: string;
  let centralAssetId: string;
  let examBId: string;
  let examBQuestionRowId: string;
  /** Tenant A's OWN exam — the vehicle for the reverse probe (pulling B's row INTO A's exam). */
  let examAId: string;
  let versionPdfAssetId: string;
  let versionAnswerSheetAssetId: string;
  let examVersionJobBId: string;
  let generationJobBId: string;

  const storageKeys: string[] = [];

  async function login(user: UserFixture): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: user.plainPassword });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`Fixture invariant violated: login failed for ${user.email} (${res.status})`);
    }
    return res.body.accessToken as string;
  }

  async function putAsset(tenantId: string | null): Promise<string> {
    const storageKey = `cross-tenant-e2e/${randomUUID()}.png`;
    await storage.put(storageKey, TINY_PNG, "image/png");
    storageKeys.push(storageKey);
    const [asset] = await db
      .insert(assets)
      .values({ tenantId, storageKey, mime: "image/png" })
      .returning({ id: assets.id });
    return asset!.id;
  }

  beforeAll(async () => {
    await ensureMigrated();
    await ensureGradeLevelsSeeded();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    storage = moduleRef.get<StoragePort>(STORAGE_PORT);

    tenantA = await createTenantFixture();
    tenantB = await createTenantFixture();
    schoolAdminA = await createUserFixture({ role: Role.SchoolAdmin, tenantId: tenantA.id });
    teacherA = await createUserFixture({ role: Role.Teacher, tenantId: tenantA.id });
    schoolAdminB = await createUserFixture({ role: Role.SchoolAdmin, tenantId: tenantB.id });
    teacherB = await createUserFixture({ role: Role.Teacher, tenantId: tenantB.id });

    tokenSchoolAdminA = await login(schoolAdminA);
    tokenTeacherA = await login(teacherA);
    tokenSchoolAdminB = await login(schoolAdminB);
    tokenTeacherB = await login(teacherB);

    topic = await ensureTopicFixture();

    // --- Tenant B's private bank ---
    assetBId = await putAsset(tenantB.id);
    const [questionB] = await db
      .insert(questions)
      .values({
        tenantId: tenantB.id,
        type: "image",
        topicId: topic.id,
        difficulty: Difficulty.Easy,
        gradeLevel: GRADE_LEVEL,
        status: "approved",
        imageAssetId: assetBId,
        correctAnswer: "A",
        createdBy: teacherB.id,
      })
      .returning({ id: questions.id });
    questionBId = questionB!.id;

    const [draftQuestionB] = await db
      .insert(questions)
      .values({
        tenantId: tenantB.id,
        type: "image",
        topicId: topic.id,
        difficulty: Difficulty.Easy,
        gradeLevel: GRADE_LEVEL,
        status: "draft",
        imageAssetId: await putAsset(tenantB.id),
        correctAnswer: "B",
        createdBy: teacherB.id,
        aiGenerated: true,
      })
      .returning({ id: questions.id });
    draftQuestionBId = draftQuestionB!.id;

    // --- Central (shared-by-design) row, the deliberate 200 control ---
    centralAssetId = await putAsset(null);
    const [centralQuestion] = await db
      .insert(questions)
      .values({
        tenantId: null,
        type: "image",
        topicId: topic.id,
        difficulty: Difficulty.Easy,
        gradeLevel: GRADE_LEVEL,
        status: "approved",
        imageAssetId: centralAssetId,
        correctAnswer: "C",
        createdBy: teacherB.id,
      })
      .returning({ id: questions.id });
    centralQuestionId = centralQuestion!.id;

    // --- Tenant B's exam, with a real selection so every mutating route
    // would genuinely succeed for B (a probe blocked by a state check
    // instead of the tenant check would prove nothing). ---
    const [examB] = await db
      .insert(exams)
      .values({
        tenantId: tenantB.id,
        title: `Cross-tenant target exam ${randomUUID()}`,
        gradeLevel: GRADE_LEVEL,
        createdBy: teacherB.id,
      })
      .returning({ id: exams.id });
    examBId = examB!.id;

    const [blueprintRow] = await db
      .insert(examBlueprintRows)
      .values({ examId: examBId, courseId: topic.courseId, topicId: topic.id, difficulty: Difficulty.Easy, count: 1 })
      .returning({ id: examBlueprintRows.id });
    examBQuestionRowId = blueprintRow!.id;

    await db
      .insert(examQuestions)
      .values({ examId: examBId, questionId: questionBId, blueprintRowId: examBQuestionRowId, position: 1 });

    versionPdfAssetId = await putAsset(tenantB.id);
    versionAnswerSheetAssetId = await putAsset(tenantB.id);
    await db.insert(examVersions).values({
      examId: examBId,
      code: "A",
      questionOrder: [questionBId],
      alternativeOrders: null,
      answerKey: [{ questionId: questionBId, answer: "A" }],
      pdfAssetId: versionPdfAssetId,
      answerSheetAssetId: versionAnswerSheetAssetId,
    });

    const [versionJob] = await db
      .insert(examVersionJobs)
      .values({
        tenantId: tenantB.id,
        examId: examBId,
        createdBy: teacherB.id,
        createdByRole: Role.Teacher,
        versionCount: 1,
        status: "completed",
        completedCount: 1,
      })
      .returning({ id: examVersionJobs.id });
    examVersionJobBId = versionJob!.id;

    // --- Tenant A's own draft exam, holding the CENTRAL question. Every
    // probe so far pushes A at B's rows; this one is the mirror image —
    // A operating on its own exam but naming one of B's rows as input. ---
    const [examA] = await db
      .insert(exams)
      .values({
        tenantId: tenantA.id,
        title: `Cross-tenant probe vehicle ${randomUUID()}`,
        gradeLevel: GRADE_LEVEL,
        createdBy: teacherA.id,
      })
      .returning({ id: exams.id });
    examAId = examA!.id;

    const [blueprintRowA] = await db
      .insert(examBlueprintRows)
      .values({ examId: examAId, courseId: topic.courseId, topicId: topic.id, difficulty: Difficulty.Easy, count: 1 })
      .returning({ id: examBlueprintRows.id });

    await db
      .insert(examQuestions)
      .values({ examId: examAId, questionId: centralQuestionId, blueprintRowId: blueprintRowA!.id, position: 1 });

    const [generationJob] = await db
      .insert(generationJobs)
      .values({
        tenantId: tenantB.id,
        createdBy: teacherB.id,
        createdByRole: Role.Teacher,
        courseId: topic.courseId,
        topicId: topic.id,
        difficulty: Difficulty.Easy,
        gradeLevel: GRADE_LEVEL,
        count: 1,
        status: "completed",
      })
      .returning({ id: generationJobs.id });
    generationJobBId = generationJob!.id;
  });

  afterAll(async () => {
    // FK order: versions/jobs -> selection -> blueprint -> exam -> questions -> assets -> users -> tenants.
    await db.delete(examVersions).where(eq(examVersions.examId, examBId));
    await db.delete(examVersionJobs).where(eq(examVersionJobs.examId, examBId));
    await db.delete(generationJobs).where(eq(generationJobs.tenantId, tenantB.id));
    await db.delete(examQuestions).where(inArray(examQuestions.examId, [examBId, examAId]));
    await db.delete(examBlueprintRows).where(inArray(examBlueprintRows.examId, [examBId, examAId]));
    await db.delete(exams).where(inArray(exams.id, [examBId, examAId]));
    await db
      .delete(questions)
      .where(inArray(questions.id, [questionBId, draftQuestionBId, centralQuestionId]));
    await db.delete(assets).where(eq(assets.tenantId, tenantB.id));
    await db.delete(assets).where(eq(assets.id, centralAssetId));
    for (const key of storageKeys) {
      await storage.delete(key);
    }
    await deleteTopicAndCourseFixture(topic);
    await deleteUserFixture(schoolAdminA.id);
    await deleteUserFixture(teacherA.id);
    await deleteUserFixture(schoolAdminB.id);
    await deleteUserFixture(teacherB.id);
    await deleteTenantFixture(tenantA.id);
    await deleteTenantFixture(tenantB.id);
    await app.close();
    await closeDbPool();
  });

  /** Every probe must land here: refused outright, or refused by pretending the row does not exist. */
  function expectDenied(status: number): void {
    expect([403, 404]).toContain(status);
  }

  /**
   * Reads an SSE endpoint and returns whatever bytes reached the wire within
   * `deadlineMs`, whether or not the server ever ends the response.
   *
   * Bounded on purpose: an SSE route that is still streaming never ends the
   * response on its own, so an unbounded read would hang the suite.
   *
   * HISTORICAL NOTE — both SSE handlers used to call `res.flushHeaders()`
   * (sending `200 OK`) BEFORE their tenant-scoped `service.get()` lookup, so
   * on a cross-tenant id the `NotFoundException` was thrown too late to
   * change the status, `AllExceptionsFilter` crashed on
   * `ERR_HTTP_HEADERS_SENT`, and the process died. That is fixed: the lookup
   * now runs first and a cross-tenant id gets a plain 404. The negative
   * probes for both stream routes live in
   * `modules/ai/sse-stream-not-found.e2e.spec.ts`, which asserts the status
   * code as well as the frames; only the positive controls stay here.
   */
  async function readSseFrames(path: string, token: string, deadlineMs = 2000): Promise<string> {
    let received = "";

    try {
      await request(app.getHttpServer())
        .get(path)
        .set("Authorization", `Bearer ${token}`)
        .buffer(true)
        .timeout({ deadline: deadlineMs })
        .parse((message, callback) => {
          message.on("data", (chunk: Buffer) => {
            received += chunk.toString();
          });
          message.on("end", () => callback(null, received));
        });
    } catch {
      // Timed out / aborted — `received` still holds every byte that did arrive.
    }

    return received;
  }

  describe("exams", () => {
    it("positive control: tenant B's own teacher can read the target exam", async () => {
      const res = await request(app.getHttpServer())
        .get(`/exams/${examBId}`)
        .set("Authorization", `Bearer ${tokenTeacherB}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(examBId);
    });

    it("denies tenant A reading tenant B's exam (GET /exams/:examId)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/exams/${examBId}`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expectDenied(res.status);
      // The error message echoes the id the CALLER supplied — that is not a
      // leak. What must be absent is the ROW: title, grade, selection.
      expect(res.body.title).toBeUndefined();
      expect(res.body.gradeLevel).toBeUndefined();
    });

    it("omits tenant B's exam from tenant A's list (GET /exams)", async () => {
      const res = await request(app.getHttpServer())
        .get("/exams?page=1&pageSize=100")
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expect(res.status).toBe(200);
      const ids = (res.body.items as ReadonlyArray<{ id: string }>).map((item) => item.id);
      expect(ids).not.toContain(examBId);
    });

    it("denies tenant A renaming tenant B's exam (PATCH /exams/:examId)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/exams/${examBId}`)
        .set("Authorization", `Bearer ${tokenTeacherA}`)
        .send({ title: "Hijacked by tenant A" });

      expectDenied(res.status);

      const [row] = await db.select({ title: exams.title }).from(exams).where(eq(exams.id, examBId));
      expect(row!.title).not.toBe("Hijacked by tenant A");
    });

    it("denies tenant A duplicating tenant B's exam (POST /exams/:examId/duplicate)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/exams/${examBId}/duplicate`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expectDenied(res.status);
    });

    it("denies tenant A confirming tenant B's exam (POST /exams/:examId/confirm)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/exams/${examBId}/confirm`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expectDenied(res.status);

      const [row] = await db.select({ status: exams.status }).from(exams).where(eq(exams.id, examBId));
      expect(row!.status).toBe("draft");
    });

    it("denies tenant A replacing a question in tenant B's exam (POST /exams/:examId/questions/:questionId/replace)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/exams/${examBId}/questions/${questionBId}/replace`)
        .set("Authorization", `Bearer ${tokenTeacherA}`)
        .send({ mode: "reroll" });

      expectDenied(res.status);
    });

    /**
     * The MIRROR IMAGE of every other probe: tenant A operating on its own
     * exam, but naming one of tenant B's private questions as the
     * replacement. The exam-ownership check passes here — the only thing
     * standing between A and B's question text is that
     * `getQuestionPool({tenantId: A})` never put B's row in the candidate
     * pool. Denied with 400 rather than 403/404, because from the service's
     * point of view the id simply isn't a valid candidate; that is a
     * refusal, not a leak, so the assertion is on the outcome (non-2xx +
     * selection unchanged) rather than on a specific status.
     */
    it("denies tenant A pulling tenant B's question into tenant A's own exam (POST /exams/:examId/questions/:questionId/replace, manual)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/exams/${examAId}/questions/${centralQuestionId}/replace`)
        .set("Authorization", `Bearer ${tokenTeacherA}`)
        .send({ mode: "manual", replacementQuestionId: questionBId });

      expect(res.status).toBeGreaterThanOrEqual(400);

      const selection = await db
        .select({ questionId: examQuestions.questionId })
        .from(examQuestions)
        .where(eq(examQuestions.examId, examAId));
      expect(selection.map((row) => row.questionId)).toEqual([centralQuestionId]);
    });

    it("denies tenant A listing tenant B's exam versions (GET /exams/:examId/versions)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/exams/${examBId}/versions`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expectDenied(res.status);
    });

    it("positive control: tenant B's own teacher can download the versions ZIP", async () => {
      const res = await request(app.getHttpServer())
        .get(`/exams/${examBId}/versions/zip`)
        .set("Authorization", `Bearer ${tokenTeacherB}`)
        .buffer(true);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/zip");
    });

    it("denies tenant A downloading tenant B's versions ZIP (GET /exams/:examId/versions/zip)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/exams/${examBId}/versions/zip`)
        .set("Authorization", `Bearer ${tokenTeacherA}`)
        .buffer(true);

      expectDenied(res.status);
      expect(res.headers["content-type"]).not.toContain("application/zip");
    });

    it("denies tenant A enqueuing a version generation for tenant B's exam (POST /exams/:examId/versions)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/exams/${examBId}/versions`)
        .set("Authorization", `Bearer ${tokenTeacherA}`)
        .send({ versionCount: 1 });

      expectDenied(res.status);

      const rows = await db
        .select({ tenantId: examVersionJobs.tenantId })
        .from(examVersionJobs)
        .where(eq(examVersionJobs.examId, examBId));
      expect(rows.every((row) => row.tenantId === tenantB.id)).toBe(true);
    });

    it("denies tenant A deleting tenant B's exam (DELETE /exams/:examId)", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/exams/${examBId}`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expectDenied(res.status);

      const rows = await db.select({ id: exams.id }).from(exams).where(eq(exams.id, examBId));
      expect(rows).toHaveLength(1);
    });
  });

  describe("exam version jobs", () => {
    it("positive control: tenant B's own teacher can read the version job", async () => {
      const res = await request(app.getHttpServer())
        .get(`/exams/${examBId}/versions/jobs/${examVersionJobBId}`)
        .set("Authorization", `Bearer ${tokenTeacherB}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(examVersionJobBId);
    });

    it("denies tenant A reading tenant B's version job (GET /exams/:examId/versions/jobs/:jobId)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/exams/${examBId}/versions/jobs/${examVersionJobBId}`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expectDenied(res.status);
      expect(JSON.stringify(res.body)).not.toContain(tenantB.id);
    });

    /**
     * `latest` is a "may legitimately be empty" read (same reasoning as
     * `listVersions` returning `[]`), so the contract here is not a status
     * code but the payload: tenant A must never be handed B's job row.
     */
    it("never hands tenant A tenant B's latest version job (GET /exams/:examId/versions/jobs/latest)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/exams/${examBId}/versions/jobs/latest`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expect(JSON.stringify(res.body ?? null)).not.toContain(examVersionJobBId);
    });

    /**
     * The stream's payload comes from the same tenant-scoped
     * `versionJobsService.get()` the probe above already proved returns 404
     * cross-tenant — so this control exists to show the stream really does
     * emit that row for its OWNER, which is what makes the 404 meaningful.
     * See `readSseFrames` for why the cross-tenant half of this pair is
     * reported in prose instead of asserted here.
     */
    it("positive control: tenant B's own teacher does receive the version job frame on the stream", async () => {
      const frames = await readSseFrames(
        `/exams/${examBId}/versions/jobs/${examVersionJobBId}/stream`,
        tokenTeacherB,
      );

      expect(frames).toContain("data:");
      expect(frames).toContain(examVersionJobBId);
    });
  });

  describe("bank questions", () => {
    it("positive control: tenant B's own teacher can read the private question", async () => {
      const res = await request(app.getHttpServer())
        .get(`/bank/questions/${questionBId}`)
        .set("Authorization", `Bearer ${tokenTeacherB}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(questionBId);
    });

    /**
     * NOT a leak — the central bank (`tenantId: null`) is shared with every
     * school on purpose. Asserted so a future over-eager tenant filter that
     * hides central questions from tenants fails here, loudly.
     */
    it("allows tenant A to read a CENTRAL question (shared by design, not a leak)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/bank/questions/${centralQuestionId}`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(centralQuestionId);
    });

    it("denies tenant A reading tenant B's question (GET /bank/questions/:id)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/bank/questions/${questionBId}`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expectDenied(res.status);
      // Same reasoning as the exam probe: the echoed id came from the
      // caller. The question's CONTENT is what must never come back.
      expect(res.body.correctAnswer).toBeUndefined();
      expect(res.body.imageAssetId).toBeUndefined();
    });

    it("omits tenant B's question from tenant A's list (GET /bank/questions)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/bank/questions?topicId=${topic.id}&page=1&pageSize=100`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expect(res.status).toBe(200);
      const ids = (res.body.items as ReadonlyArray<{ id: string }>).map((item) => item.id);
      expect(ids).not.toContain(questionBId);
      expect(ids).not.toContain(draftQuestionBId);
      // Same request, same filter: the central row IS expected — proves the
      // exclusion above is tenant scoping, not an empty result set.
      expect(ids).toContain(centralQuestionId);
    });

    it("does not count tenant B's questions in tenant A's summary (GET /bank/questions/summary)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/bank/questions/summary?topicId=${topic.id}`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expect(res.status).toBe(200);
      const rows = res.body as ReadonlyArray<{ topicId: string; total: number }>;
      const total = rows.filter((row) => row.topicId === topic.id).reduce((sum, row) => sum + Number(row.total), 0);
      // Only the central question is visible to tenant A on this topic —
      // B's two private rows must not be counted.
      expect(total).toBe(1);
    });

    it("denies tenant A editing tenant B's question (PATCH /bank/questions/:id)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/bank/questions/${questionBId}`)
        .set("Authorization", `Bearer ${tokenTeacherA}`)
        .send({ correctAnswer: "D" });

      expectDenied(res.status);

      const [row] = await db
        .select({ correctAnswer: questions.correctAnswer })
        .from(questions)
        .where(eq(questions.id, questionBId));
      expect(row!.correctAnswer).toBe("A");
    });

    it("denies tenant A archiving tenant B's question (PATCH /bank/questions/:id/archive)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/bank/questions/${questionBId}/archive`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expectDenied(res.status);

      const [row] = await db
        .select({ status: questions.status })
        .from(questions)
        .where(eq(questions.id, questionBId));
      expect(row!.status).toBe("approved");
    });

    it("denies tenant A approving tenant B's draft (POST /bank/questions/:id/approve)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/bank/questions/${draftQuestionBId}/approve`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expectDenied(res.status);

      const [row] = await db
        .select({ status: questions.status })
        .from(questions)
        .where(eq(questions.id, draftQuestionBId));
      expect(row!.status).toBe("draft");
    });

    it("denies tenant A rejecting (deleting) tenant B's draft (POST /bank/questions/:id/reject)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/bank/questions/${draftQuestionBId}/reject`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expectDenied(res.status);

      const rows = await db.select({ id: questions.id }).from(questions).where(eq(questions.id, draftQuestionBId));
      expect(rows).toHaveLength(1);
    });

    it("denies tenant A deleting tenant B's draft (DELETE /bank/questions/:id)", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/bank/questions/${draftQuestionBId}`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expectDenied(res.status);

      const rows = await db.select({ id: questions.id }).from(questions).where(eq(questions.id, draftQuestionBId));
      expect(rows).toHaveLength(1);
    });

    it("denies tenant A replacing the image of tenant B's question (POST /bank/questions/:id/image)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/bank/questions/${questionBId}/image`)
        .set("Authorization", `Bearer ${tokenTeacherA}`)
        .attach("file", TINY_PNG, { filename: "hijack.png", contentType: "image/png" });

      expectDenied(res.status);

      const [row] = await db
        .select({ imageAssetId: questions.imageAssetId })
        .from(questions)
        .where(eq(questions.id, questionBId));
      expect(row!.imageAssetId).toBe(assetBId);
    });

    it("denies tenant A attaching alternative images to tenant B's question (POST /bank/questions/:id/alternative-images)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/bank/questions/${questionBId}/alternative-images`)
        .set("Authorization", `Bearer ${tokenTeacherA}`)
        .attach("images", TINY_PNG, { filename: "a.png", contentType: "image/png" });

      expectDenied(res.status);
    });

    it("denies tenant A previewing tenant B's question (GET /bank/questions/:id/preview)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/bank/questions/${questionBId}/preview`)
        .set("Authorization", `Bearer ${tokenTeacherA}`)
        .buffer(true);

      expectDenied(res.status);
      expect(res.headers["content-type"]).not.toContain("application/pdf");
    });

    it("denies tenant A AI-revising tenant B's question (POST /ai/questions/:id/revise)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/ai/questions/${questionBId}/revise`)
        .set("Authorization", `Bearer ${tokenTeacherA}`)
        .send({ instruction: "make it easier" });

      expectDenied(res.status);
    });
  });

  describe("AI generation jobs", () => {
    it("positive control: tenant B's own teacher can read the generation job", async () => {
      const res = await request(app.getHttpServer())
        .get(`/ai/questions/jobs/${generationJobBId}`)
        .set("Authorization", `Bearer ${tokenTeacherB}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(generationJobBId);
    });

    it("denies tenant A reading tenant B's generation job (GET /ai/questions/jobs/:id)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/ai/questions/jobs/${generationJobBId}`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expectDenied(res.status);
      expect(JSON.stringify(res.body)).not.toContain(tenantB.id);
    });

    it("omits tenant B's job from tenant A's list (GET /ai/questions/jobs)", async () => {
      const res = await request(app.getHttpServer())
        .get("/ai/questions/jobs?page=1&pageSize=100")
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expect(res.status).toBe(200);
      const ids = (res.body.items as ReadonlyArray<{ id: string }>).map((item) => item.id);
      expect(ids).not.toContain(generationJobBId);
    });

    it("denies tenant A reading tenant B's job retry chain (GET /ai/questions/jobs/:id/chain)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/ai/questions/jobs/${generationJobBId}/chain`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expectDenied(res.status);
      // The echoed id is the caller's own input; the CHAIN is the payload
      // that must not materialize.
      expect(res.body.items).toBeUndefined();
    });

    it("denies tenant A cancelling tenant B's job (POST /ai/questions/jobs/:id/cancel)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/ai/questions/jobs/${generationJobBId}/cancel`)
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expectDenied(res.status);

      const [row] = await db
        .select({ cancelRequested: generationJobs.cancelRequested })
        .from(generationJobs)
        .where(eq(generationJobs.id, generationJobBId));
      expect(row!.cancelRequested).toBe(false);
    });

    /** Same pairing as the exam-version stream control — see `readSseFrames`. */
    it("positive control: tenant B's own teacher does receive the generation job frame on the stream", async () => {
      const frames = await readSseFrames(`/ai/questions/jobs/${generationJobBId}/stream`, tokenTeacherB);

      expect(frames).toContain("data:");
      expect(frames).toContain(generationJobBId);
    });

    /** The retry path takes the parent job id in the BODY, not the path — the same question, a different attack surface. */
    it("denies tenant A chaining a retry off tenant B's job (POST /ai/questions/jobs with retriedFromJobId)", async () => {
      const res = await request(app.getHttpServer())
        .post("/ai/questions/jobs")
        .set("Authorization", `Bearer ${tokenTeacherA}`)
        .send({
          courseId: topic.courseId,
          topicId: topic.id,
          difficulty: Difficulty.Easy,
          gradeLevel: GRADE_LEVEL,
          count: 1,
          retriedFromJobId: generationJobBId,
        });

      expectDenied(res.status);

      const rows = await db
        .select({ id: generationJobs.id })
        .from(generationJobs)
        .where(eq(generationJobs.retriedFromJobId, generationJobBId));
      expect(rows).toHaveLength(0);
    });
  });

  describe("assets", () => {
    it("positive control: tenant B's own teacher can stream the private asset", async () => {
      const res = await request(app.getHttpServer())
        .get(`/assets/${assetBId}`)
        .set("Authorization", `Bearer ${tokenTeacherB}`)
        .buffer(true);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("image/png");
    });

    it("denies tenant A streaming tenant B's private asset (GET /assets/:id)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/assets/${assetBId}`)
        .set("Authorization", `Bearer ${tokenTeacherA}`)
        .buffer(true);

      expectDenied(res.status);
      expect(res.headers["content-type"]).not.toContain("image/png");
    });

    it("denies tenant A streaming tenant B's generated exam PDF asset (GET /assets/:id)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/assets/${versionPdfAssetId}`)
        .set("Authorization", `Bearer ${tokenTeacherA}`)
        .buffer(true);

      expectDenied(res.status);
    });

    it("denies tenant A streaming tenant B's answer-sheet asset (GET /assets/:id)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/assets/${versionAnswerSheetAssetId}`)
        .set("Authorization", `Bearer ${tokenTeacherA}`)
        .buffer(true);

      expectDenied(res.status);
    });

    /** Central assets back the central bank's images — shared on purpose, same rule as the central question above. */
    it("allows tenant A to stream a CENTRAL asset (shared by design, not a leak)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/assets/${centralAssetId}`)
        .set("Authorization", `Bearer ${tokenTeacherA}`)
        .buffer(true);

      expect(res.status).toBe(200);
    });
  });

  describe("users", () => {
    it("positive control: tenant B's own school_admin can deactivate their own teacher", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${teacherB.id}`)
        .set("Authorization", `Bearer ${tokenSchoolAdminB}`)
        .send({ active: false });

      expect(res.status).toBe(200);

      // Restore — later probes still need this account to look normal.
      await request(app.getHttpServer())
        .patch(`/users/${teacherB.id}`)
        .set("Authorization", `Bearer ${tokenSchoolAdminB}`)
        .send({ active: true });
    });

    it("omits tenant B's users from tenant A's list (GET /users)", async () => {
      const res = await request(app.getHttpServer())
        .get("/users?page=1&pageSize=100")
        .set("Authorization", `Bearer ${tokenSchoolAdminA}`);

      expect(res.status).toBe(200);
      const ids = (res.body.items as ReadonlyArray<{ id: string }>).map((item) => item.id);
      expect(ids).not.toContain(teacherB.id);
      expect(ids).not.toContain(schoolAdminB.id);
    });

    it("denies tenant A deactivating tenant B's teacher (PATCH /users/:id)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${teacherB.id}`)
        .set("Authorization", `Bearer ${tokenSchoolAdminA}`)
        .send({ active: false });

      expectDenied(res.status);

      // Still able to authenticate => still active.
      const login = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: teacherB.email, password: teacherB.plainPassword });
      expect(login.status).toBe(200);
    });

    it("denies tenant A resetting tenant B's teacher password (POST /users/:id/reset-password)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/users/${teacherB.id}/reset-password`)
        .set("Authorization", `Bearer ${tokenSchoolAdminA}`);

      expectDenied(res.status);
      expect(JSON.stringify(res.body)).not.toContain("temporaryPassword");

      const login = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: teacherB.email, password: teacherB.plainPassword });
      expect(login.status).toBe(200);
    });
  });

  /**
   * The only routes scoped by `TenantGuard` rather than the service layer —
   * the param IS a tenant id here, which is the one shape that guard can
   * actually compare against the token. 403, not 404: the guard refuses
   * before any repository call, so it has nothing to pretend is missing.
   */
  describe("tenants", () => {
    it("positive control: tenant B's own school_admin can read tenant B", async () => {
      const res = await request(app.getHttpServer())
        .get(`/tenants/${tenantB.id}`)
        .set("Authorization", `Bearer ${tokenSchoolAdminB}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(tenantB.id);
    });

    it("denies tenant A reading tenant B (GET /tenants/:id)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/tenants/${tenantB.id}`)
        .set("Authorization", `Bearer ${tokenSchoolAdminA}`);

      expectDenied(res.status);
      expect(JSON.stringify(res.body)).not.toContain(tenantB.slug);
    });

    it("denies tenant A updating tenant B (PATCH /tenants/:id)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/tenants/${tenantB.id}`)
        .set("Authorization", `Bearer ${tokenSchoolAdminA}`)
        .send({ name: "Hijacked by tenant A" });

      expectDenied(res.status);
    });

    it("denies tenant A deleting tenant B (DELETE /tenants/:id)", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/tenants/${tenantB.id}`)
        .set("Authorization", `Bearer ${tokenSchoolAdminA}`);

      expectDenied(res.status);
    });

    it("denies tenant A uploading a logo for tenant B (POST /tenants/:id/logo)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/tenants/${tenantB.id}/logo`)
        .set("Authorization", `Bearer ${tokenSchoolAdminA}`)
        .attach("file", TINY_PNG, { filename: "logo.png", contentType: "image/png" });

      expectDenied(res.status);
    });

    it("denies tenant A listing every tenant (GET /tenants)", async () => {
      const res = await request(app.getHttpServer())
        .get("/tenants")
        .set("Authorization", `Bearer ${tokenSchoolAdminA}`);

      expectDenied(res.status);
    });
  });

  describe("dashboard", () => {
    it("never mixes tenant B's exams into tenant A's stats (GET /dashboard/stats)", async () => {
      const res = await request(app.getHttpServer())
        .get("/dashboard/stats")
        .set("Authorization", `Bearer ${tokenTeacherA}`);

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(examBId);
    });
  });
});
