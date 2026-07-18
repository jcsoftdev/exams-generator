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
 * Full HTTP e2e — real Nest app, real Postgres, real MinIO (docker-compose
 * `minio` service). Covers the release-gate requirement from the design
 * doc's Testing section (§8): "un tenant NUNCA ve preguntas privadas de
 * otro" must be an e2e test, not just a unit test on the repository.
 */
describe("Bank module (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  let courseId: string;
  let topicId: string;
  let staffUserId: string;
  let tenantAId: string;
  let tenantATeacherId: string;
  let tenantASchoolAdminId: string;
  let tenantBId: string;
  let tenantBTeacherId: string;

  let staffToken: string;
  let tenantAToken: string;
  let tenantASchoolAdminToken: string;
  let tenantBToken: string;
  /**
   * Role/tenantId combos `JwtAuthGuard` cannot reject on its own (it never
   * touches the DB — see `token.service.ts`), used to exercise the
   * authorization boundary added in `BankService` (design doc §2): a tenant
   * role (`teacher`) carrying `tenantId: null` is exactly what "a tenant
   * tries to create/manage centrally" looks like at the JWT layer.
   */
  let tenantRoleNoTenantIdToken: string;
  let staffRoleWithTenantIdToken: string;

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
      .values({ name: `E2E Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `E2E Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [staff] = await db
      .insert(users)
      .values({
        tenantId: null,
        email: `e2e-staff-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.ContentEditor,
      })
      .returning({ id: users.id });
    staffUserId = staff!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `E2E Tenant A ${suffix}`, slug: `e2e-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `e2e-teacher-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantATeacherId = teacherA!.id;

    const [schoolAdminA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `e2e-school-admin-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.SchoolAdmin,
      })
      .returning({ id: users.id });
    tenantASchoolAdminId = schoolAdminA!.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `E2E Tenant B ${suffix}`, slug: `e2e-tenant-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;

    const [teacherB] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `e2e-teacher-b-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantBTeacherId = teacherB!.id;

    staffToken = tokenService.sign({ sub: staffUserId, tenantId: null, role: Role.ContentEditor });
    tenantAToken = tokenService.sign({ sub: tenantATeacherId, tenantId: tenantAId, role: Role.Teacher });
    tenantASchoolAdminToken = tokenService.sign({
      sub: tenantASchoolAdminId,
      tenantId: tenantAId,
      role: Role.SchoolAdmin,
    });
    tenantBToken = tokenService.sign({ sub: tenantBTeacherId, tenantId: tenantBId, role: Role.Teacher });
    tenantRoleNoTenantIdToken = tokenService.sign({
      sub: tenantATeacherId,
      tenantId: null,
      role: Role.Teacher,
    });
    staffRoleWithTenantIdToken = tokenService.sign({
      sub: staffUserId,
      tenantId: tenantAId,
      role: Role.ContentEditor,
    });
  });

  afterAll(async () => {
    if (createdQuestionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
    }
    if (createdAssetIds.length > 0) {
      await db.delete(assets).where(inArray(assets.id, createdAssetIds));
    }
    await db
      .delete(users)
      .where(
        inArray(users.id, [
          staffUserId,
          tenantATeacherId,
          tenantASchoolAdminId,
          tenantBTeacherId,
        ]),
      );
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]));
    await db.delete(topics).where(inArray(topics.id, [topicId]));
    await db.delete(courses).where(inArray(courses.id, [courseId]));
    await app.close();
    await pool.end();
  });

  async function trackCreatedQuestion(id: string): Promise<void> {
    createdQuestionIds.push(id);
    const [row] = await db
      .select({ imageAssetId: questions.imageAssetId })
      .from(questions)
      .where(inArray(questions.id, [id]));
    if (row?.imageAssetId) {
      createdAssetIds.push(row.imageAssetId);
    }
  }

  function uploadRequest(token: string) {
    return request(app.getHttpServer())
      .post("/bank/questions/image")
      .set("Authorization", `Bearer ${token}`);
  }

  function structuredRequest(token: string) {
    return request(app.getHttpServer())
      .post("/bank/questions/structured")
      .set("Authorization", `Bearer ${token}`);
  }

  function listRequest(token: string) {
    return request(app.getHttpServer())
      .get("/bank/questions")
      .set("Authorization", `Bearer ${token}`);
  }

  function getByIdRequest(token: string, id: string) {
    return request(app.getHttpServer())
      .get(`/bank/questions/${id}`)
      .set("Authorization", `Bearer ${token}`);
  }

  function approveRequest(token: string, id: string) {
    return request(app.getHttpServer())
      .post(`/bank/questions/${id}/approve`)
      .set("Authorization", `Bearer ${token}`);
  }

  function rejectRequest(token: string, id: string) {
    return request(app.getHttpServer())
      .post(`/bank/questions/${id}/reject`)
      .set("Authorization", `Bearer ${token}`);
  }

  function editRequest(token: string, id: string) {
    return request(app.getHttpServer())
      .patch(`/bank/questions/${id}`)
      .set("Authorization", `Bearer ${token}`);
  }

  /**
   * Inserts a `status='draft'` structured question directly (mirrors
   * `exams.e2e.spec.ts`'s fixture convention) — the public create endpoints
   * always persist `status='approved'` (design doc §5.1), so approve/
   * reject/edit's authorization can't be exercised via those routes alone.
   */
  async function createDraftQuestion(tenantId: string | null, createdBy: string): Promise<string> {
    const [question] = await db
      .insert(questions)
      .values({
        tenantId,
        type: "structured",
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        status: "draft",
        bodyTypst: "borrador",
        alternatives: ["a", "b"],
        correctAnswer: "0",
        createdBy,
        aiGenerated: true,
      })
      .returning({ id: questions.id });
    createdQuestionIds.push(question!.id);
    return question!.id;
  }

  it("uploads a central question (staff, tenantId=null) and it is visible to every tenant", async () => {
    const response = await uploadRequest(staffToken)
      .field("courseId", courseId)
      .field("topicId", topicId)
      .field("difficulty", Difficulty.Easy)
      .field("gradeLevel", "primaria_1")
      .field("correctAnswer", "b")
      .attach("image", Buffer.from("fake-png-bytes"), "q.png")
      .expect(201);

    expect(response.body.id).toBeDefined();
    await trackCreatedQuestion(response.body.id);

    const listForA = await listRequest(tenantAToken).expect(200);
    const listForB = await listRequest(tenantBToken).expect(200);

    expect(listForA.body.map((q: { id: string }) => q.id)).toContain(response.body.id);
    expect(listForB.body.map((q: { id: string }) => q.id)).toContain(response.body.id);
  });

  it("uploads a tenant-private question and it is NEVER visible to another tenant", async () => {
    const response = await uploadRequest(tenantAToken)
      .field("courseId", courseId)
      .field("topicId", topicId)
      .field("difficulty", Difficulty.Medium)
      .field("gradeLevel", "secundaria_1")
      .field("correctAnswer", "d")
      .attach("image", Buffer.from("fake-png-bytes"), "q.png")
      .expect(201);

    await trackCreatedQuestion(response.body.id);

    const listForA = await listRequest(tenantAToken).expect(200);
    const listForB = await listRequest(tenantBToken).expect(200);

    expect(listForA.body.map((q: { id: string }) => q.id)).toContain(response.body.id);
    expect(listForB.body.map((q: { id: string }) => q.id)).not.toContain(response.body.id);
  });

  it("is symmetric: a question private to tenant B is NEVER visible to tenant A", async () => {
    const response = await uploadRequest(tenantBToken)
      .field("courseId", courseId)
      .field("topicId", topicId)
      .field("difficulty", Difficulty.Medium)
      .field("gradeLevel", "secundaria_2")
      .field("correctAnswer", "c")
      .attach("image", Buffer.from("fake-png-bytes"), "q.png")
      .expect(201);

    await trackCreatedQuestion(response.body.id);

    const listForB = await listRequest(tenantBToken).expect(200);
    const listForA = await listRequest(tenantAToken).expect(200);
    const listForStaff = await listRequest(staffToken).expect(200);

    expect(listForB.body.map((q: { id: string }) => q.id)).toContain(response.body.id);
    expect(listForA.body.map((q: { id: string }) => q.id)).not.toContain(response.body.id);
    expect(listForStaff.body.map((q: { id: string }) => q.id)).not.toContain(response.body.id);
  });

  it("GET /bank/questions/:id — a tenant can fetch its own private question directly by id", async () => {
    const created = await uploadRequest(tenantAToken)
      .field("courseId", courseId)
      .field("topicId", topicId)
      .field("difficulty", Difficulty.Easy)
      .field("gradeLevel", "primaria_2")
      .field("correctAnswer", "b")
      .attach("image", Buffer.from("fake-png-bytes"), "q.png")
      .expect(201);
    await trackCreatedQuestion(created.body.id);

    const response = await getByIdRequest(tenantAToken, created.body.id).expect(200);

    expect(response.body.id).toBe(created.body.id);
  });

  it("GET /bank/questions/:id — a central (tenantId=null) question is fetchable by any tenant", async () => {
    const created = await uploadRequest(staffToken)
      .field("courseId", courseId)
      .field("topicId", topicId)
      .field("difficulty", Difficulty.Easy)
      .field("gradeLevel", "primaria_2")
      .field("correctAnswer", "b")
      .attach("image", Buffer.from("fake-png-bytes"), "q.png")
      .expect(201);
    await trackCreatedQuestion(created.body.id);

    const forA = await getByIdRequest(tenantAToken, created.body.id).expect(200);
    const forB = await getByIdRequest(tenantBToken, created.body.id).expect(200);

    expect(forA.body.id).toBe(created.body.id);
    expect(forB.body.id).toBe(created.body.id);
  });

  it("GET /bank/questions/:id — 404 when tenant B tries to fetch tenant A's private question directly by id (enumeration guard)", async () => {
    const created = await uploadRequest(tenantAToken)
      .field("courseId", courseId)
      .field("topicId", topicId)
      .field("difficulty", Difficulty.Hard)
      .field("gradeLevel", "secundaria_4")
      .field("correctAnswer", "d")
      .attach("image", Buffer.from("fake-png-bytes"), "q.png")
      .expect(201);
    await trackCreatedQuestion(created.body.id);

    await getByIdRequest(tenantBToken, created.body.id).expect(404);
    await getByIdRequest(staffToken, created.body.id).expect(404);
  });

  it("GET /bank/questions/:id — 404 for a non-existent id", async () => {
    await getByIdRequest(tenantAToken, randomUUID()).expect(404);
  });

  it("GET /bank/questions/:id — 401 when no Authorization header is sent", async () => {
    await request(app.getHttpServer()).get(`/bank/questions/${randomUUID()}`).expect(401);
  });

  it("combines course/topic/difficulty/gradeLevel filters", async () => {
    const target = await uploadRequest(staffToken)
      .field("courseId", courseId)
      .field("topicId", topicId)
      .field("difficulty", Difficulty.Hard)
      .field("gradeLevel", "secundaria_5")
      .field("correctAnswer", "e")
      .attach("image", Buffer.from("fake-png-bytes"), "q.png")
      .expect(201);
    await trackCreatedQuestion(target.body.id);

    const nonMatching = await uploadRequest(staffToken)
      .field("courseId", courseId)
      .field("topicId", topicId)
      .field("difficulty", Difficulty.Easy)
      .field("gradeLevel", "secundaria_5")
      .field("correctAnswer", "a")
      .attach("image", Buffer.from("fake-png-bytes"), "q.png")
      .expect(201);
    await trackCreatedQuestion(nonMatching.body.id);

    const response = await request(app.getHttpServer())
      .get("/bank/questions")
      .query({ courseId, topicId, difficulty: Difficulty.Hard, gradeLevel: "secundaria_5" })
      .set("Authorization", `Bearer ${staffToken}`)
      .expect(200);

    const ids = response.body.map((q: { id: string }) => q.id);
    expect(ids).toContain(target.body.id);
    expect(ids).not.toContain(nonMatching.body.id);
  });

  it("POST /bank/questions/structured — creates a structured question with status=approved and surfaces its fields via GET", async () => {
    const response = await structuredRequest(staffToken)
      .send({
        courseId,
        topicId,
        difficulty: Difficulty.Medium,
        gradeLevel: "secundaria_1",
        bodyTypst: "$x + 1 = 2$, resuelve para $x$",
        alternatives: ["1", "2", "3"],
        correctAnswer: "0",
      })
      .expect(201);

    expect(response.body.id).toBeDefined();
    await trackCreatedQuestion(response.body.id);

    const fetched = await getByIdRequest(staffToken, response.body.id).expect(200);
    expect(fetched.body.type).toBe("structured");
    expect(fetched.body.bodyTypst).toBe("$x + 1 = 2$, resuelve para $x$");
    expect(fetched.body.alternatives).toEqual(["1", "2", "3"]);
  });

  it("POST /bank/questions/structured — a tenant-private structured question is NEVER visible to another tenant", async () => {
    const response = await structuredRequest(tenantAToken)
      .send({
        courseId,
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        bodyTypst: "enunciado privado",
        alternatives: ["a", "b"],
        correctAnswer: "1",
      })
      .expect(201);
    await trackCreatedQuestion(response.body.id);

    const listForA = await listRequest(tenantAToken).expect(200);
    const listForB = await listRequest(tenantBToken).expect(200);

    expect(listForA.body.map((q: { id: string }) => q.id)).toContain(response.body.id);
    expect(listForB.body.map((q: { id: string }) => q.id)).not.toContain(response.body.id);
  });

  it("POST /bank/questions/structured — rejects with 400 listing every missing field", async () => {
    const response = await structuredRequest(staffToken).send({}).expect(400);

    const bodyText = JSON.stringify(response.body);
    for (const keyword of [
      "courseId",
      "topicId",
      "difficulty",
      "gradeLevel",
      "bodyTypst",
      "alternatives",
      "correctAnswer",
    ]) {
      expect(bodyText).toContain(keyword);
    }
  });

  it("POST /bank/questions/structured — rejects with 400 when correctAnswer is out of bounds", async () => {
    await structuredRequest(staffToken)
      .send({
        courseId,
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        bodyTypst: "enunciado",
        alternatives: ["a", "b"],
        correctAnswer: "9",
      })
      .expect(400);
  });

  it("POST /bank/questions/structured — rejects with 401 when no Authorization header is sent", async () => {
    await request(app.getHttpServer()).post("/bank/questions/structured").send({}).expect(401);
  });

  it("rejects with 400 listing every missing field (correctAnswer/course/topic/difficulty/gradeLevel)", async () => {
    const response = await request(app.getHttpServer())
      .post("/bank/questions/image")
      .set("Authorization", `Bearer ${staffToken}`)
      .attach("image", Buffer.from("fake-png-bytes"), "q.png")
      .expect(400);

    const bodyText = JSON.stringify(response.body);
    for (const keyword of ["courseId", "topicId", "difficulty", "gradeLevel", "correctAnswer"]) {
      expect(bodyText).toContain(keyword);
    }
  });

  it("rejects with 400 when the image file is missing", async () => {
    await uploadRequest(staffToken)
      .field("courseId", courseId)
      .field("topicId", topicId)
      .field("difficulty", Difficulty.Easy)
      .field("gradeLevel", "primaria_1")
      .field("correctAnswer", "a")
      .expect(400);
  });

  it("rejects with 401 when no Authorization header is sent", async () => {
    await request(app.getHttpServer()).get("/bank/questions").expect(401);
  });

  describe("Role-based authorization (design doc §2: central bank is staff-only, tenant bank is school-staff-only)", () => {
    it("403 when a tenant role (teacher, tenantId=null on the token) tries to create centrally", async () => {
      await uploadRequest(tenantRoleNoTenantIdToken)
        .field("courseId", courseId)
        .field("topicId", topicId)
        .field("difficulty", Difficulty.Easy)
        .field("gradeLevel", "primaria_1")
        .field("correctAnswer", "a")
        .attach("image", Buffer.from("fake-png-bytes"), "q.png")
        .expect(403);

      await structuredRequest(tenantRoleNoTenantIdToken)
        .send({
          courseId,
          topicId,
          difficulty: Difficulty.Easy,
          gradeLevel: "primaria_1",
          bodyTypst: "x",
          alternatives: ["a", "b"],
          correctAnswer: "0",
        })
        .expect(403);
    });

    it("403 when a staff role (content_editor, tenantId set on the token) tries to create for a tenant", async () => {
      await uploadRequest(staffRoleWithTenantIdToken)
        .field("courseId", courseId)
        .field("topicId", topicId)
        .field("difficulty", Difficulty.Easy)
        .field("gradeLevel", "primaria_1")
        .field("correctAnswer", "a")
        .attach("image", Buffer.from("fake-png-bytes"), "q.png")
        .expect(403);

      await structuredRequest(staffRoleWithTenantIdToken)
        .send({
          courseId,
          topicId,
          difficulty: Difficulty.Easy,
          gradeLevel: "primaria_1",
          bodyTypst: "x",
          alternatives: ["a", "b"],
          correctAnswer: "0",
        })
        .expect(403);
    });

    it("403 when a tenant's teacher tries to approve/reject/edit a CENTRAL draft", async () => {
      const id = await createDraftQuestion(null, staffUserId);

      await approveRequest(tenantAToken, id).expect(403);
      await rejectRequest(tenantAToken, id).expect(403);
      await editRequest(tenantAToken, id).send({ bodyTypst: "hacked" }).expect(403);

      // Sanity: the draft is untouched and staff can still approve it.
      const stillDraft = await getByIdRequest(staffToken, id).expect(200);
      expect(stillDraft.body.status).toBe("draft");
      await approveRequest(staffToken, id).expect(201);
    });

    it("403 when a tenant's school_admin tries to approve/reject/edit a CENTRAL draft", async () => {
      const id = await createDraftQuestion(null, staffUserId);

      await approveRequest(tenantASchoolAdminToken, id).expect(403);
      await rejectRequest(tenantASchoolAdminToken, id).expect(403);
      await editRequest(tenantASchoolAdminToken, id).send({ bodyTypst: "hacked" }).expect(403);
    });

    it("200/201: platform staff (content_editor) can approve/reject/edit a CENTRAL draft", async () => {
      const editableId = await createDraftQuestion(null, staffUserId);
      const edited = await editRequest(staffToken, editableId)
        .send({ bodyTypst: "revisado por staff" })
        .expect(200);
      expect(edited.body.bodyTypst).toBe("revisado por staff");
      await approveRequest(staffToken, editableId).expect(201);

      const rejectableId = await createDraftQuestion(null, staffUserId);
      await rejectRequest(staffToken, rejectableId).expect(201);
    });

    it("200/201: a tenant's teacher and school_admin can approve/reject/edit their OWN tenant's draft", async () => {
      const teacherDraftId = await createDraftQuestion(tenantAId, tenantATeacherId);
      const editedByTeacher = await editRequest(tenantAToken, teacherDraftId)
        .send({ bodyTypst: "editado por profesor" })
        .expect(200);
      expect(editedByTeacher.body.bodyTypst).toBe("editado por profesor");
      await approveRequest(tenantAToken, teacherDraftId).expect(201);

      const schoolAdminDraftId = await createDraftQuestion(tenantAId, tenantASchoolAdminId);
      await rejectRequest(tenantASchoolAdminToken, schoolAdminDraftId).expect(201);
    });
  });
});
