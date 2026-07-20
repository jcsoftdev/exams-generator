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
import { ExamsRepository } from "../exams/exams.repository";

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
    const cleanupSteps: Array<[string, () => Promise<unknown>]> = [
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
      [
        "delete users",
        () =>
          db
            .delete(users)
            .where(
              inArray(users.id, [
                staffUserId,
                tenantATeacherId,
                tenantASchoolAdminId,
                tenantBTeacherId,
              ]),
            ),
      ],
      ["delete tenants", () => db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))],
      ["delete topics", () => db.delete(topics).where(inArray(topics.id, [topicId]))],
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

  /**
   * Lane D4 (S4/S5): archive an `approved` question (soft-remove from the
   * bank — never deleted) and delete a `draft` outright. Same
   * `assertCanManageTenant`/`requireVisibleDraft` gates the rest of the
   * module already exercises.
   */
  describe("archive & delete", () => {
    async function createApprovedQuestion(token: string): Promise<string> {
      const response = await structuredRequest(token)
        .send({
          courseId,
          topicId,
          difficulty: Difficulty.Easy,
          gradeLevel: "primaria_1",
          bodyTypst: "pregunta aprobada para archive/delete tests",
          alternatives: ["a", "b"],
          correctAnswer: "0",
        })
        .expect(201);
      await trackCreatedQuestion(response.body.id);
      return response.body.id;
    }

    it("archives an approved own-tenant question", async () => {
      const approvedQuestionId = await createApprovedQuestion(tenantAToken);

      const res = await request(app.getHttpServer())
        .patch(`/bank/questions/${approvedQuestionId}/archive`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(200);

      expect(res.body.status).toBe("archived");
    });

    it("409 archiving a draft", async () => {
      const draftQuestionId = await createDraftQuestion(tenantAId, tenantATeacherId);

      await request(app.getHttpServer())
        .patch(`/bank/questions/${draftQuestionId}/archive`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(409);
    });

    it("teacher cannot archive central-bank question", async () => {
      const centralQuestionId = await createApprovedQuestion(staffToken);

      await request(app.getHttpServer())
        .patch(`/bank/questions/${centralQuestionId}/archive`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(403);
    });

    it("deletes an own draft, 404 after", async () => {
      const ownDraftId = await createDraftQuestion(tenantAId, tenantATeacherId);

      await request(app.getHttpServer())
        .delete(`/bank/questions/${ownDraftId}`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(204);

      await getByIdRequest(tenantAToken, ownDraftId).expect(404);
    });

    it("409 deleting an approved question", async () => {
      const anotherApprovedId = await createApprovedQuestion(tenantAToken);

      await request(app.getHttpServer())
        .delete(`/bank/questions/${anotherApprovedId}`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(409);
    });

    it("an archived question NEVER enters the exam question pool (release gate)", async () => {
      const archivedId = await createApprovedQuestion(tenantAToken);
      await request(app.getHttpServer())
        .patch(`/bank/questions/${archivedId}/archive`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(200);

      const examsRepository = new ExamsRepository();
      const pool = await examsRepository.getQuestionPool({
        tenantId: tenantAId,
        gradeLevel: "primaria_1",
      });

      expect(pool.map((q) => q.id)).not.toContain(archivedId);
    });
  });

  /**
   * S6: `GET /bank/questions` gains OPTIONAL pagination. Without `page` it
   * MUST keep returning the bare array (retro-compat release gate — web's
   * `bank.service.ts` and `ai.service.ts` `listDrafts` both consume this
   * endpoint today expecting a flat array). Only when `page` is present does
   * the response switch to `{ items, total }`.
   */
  describe("GET /bank/questions pagination (S6)", () => {
    it("returns flat array without page param (legacy)", async () => {
      const res = await request(app.getHttpServer())
        .get("/bank/questions")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("returns {items,total} with page param", async () => {
      const res = await request(app.getHttpServer())
        .get("/bank/questions?page=1&pageSize=2")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      expect(typeof res.body.total).toBe("number");
    });

    /**
     * Behavioral proof that `pageSize=0` actually clamps to 1 by the time it
     * reaches the SQL `LIMIT` — not just a shape assertion. Needs >=2
     * visible questions in tenant A's pool so `items.length === 1` can only
     * hold if the clamp landed; with a single-question fixture this
     * assertion would pass vacuously regardless of clamping.
     *
     * The upper-bound clamp (`pageSize` capped at 100) is covered by the
     * `clampPagination` unit test (`pagination.util.spec.ts`) instead of
     * here — asserting it e2e would require seeding 100+ questions, which
     * this suite deliberately avoids.
     */
    it("clamps page=0&pageSize=0 to page=1&pageSize=1, landing in the SQL LIMIT", async () => {
      await structuredRequest(tenantAToken)
        .send({
          courseId,
          topicId,
          difficulty: Difficulty.Easy,
          gradeLevel: "primaria_1",
          bodyTypst: "pagination fixture question 1",
          alternatives: ["a", "b"],
          correctAnswer: "0",
        })
        .expect(201)
        .then((res) => trackCreatedQuestion(res.body.id));

      await structuredRequest(tenantAToken)
        .send({
          courseId,
          topicId,
          difficulty: Difficulty.Easy,
          gradeLevel: "primaria_1",
          bodyTypst: "pagination fixture question 2",
          alternatives: ["a", "b"],
          correctAnswer: "0",
        })
        .expect(201)
        .then((res) => trackCreatedQuestion(res.body.id));

      const res = await request(app.getHttpServer())
        .get("/bank/questions?page=0&pageSize=0")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(200);

      expect(res.body.items.length).toBe(1);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
    });
  });

  /**
   * S7: single-question Typst PDF preview, in-memory cached by question id.
   * Only `type='structured'` questions can be previewed (an image question's
   * "preview" is just the uploaded image itself, rendered directly by the
   * front end — no Typst compile involved). The cache is invalidated by
   * `PATCH :id` (`editDraftQuestion`) so a re-fetched preview never serves a
   * stale compile after an edit.
   */
  describe("GET /bank/questions/:id/preview (S7)", () => {
    function previewRequest(token: string, id: string) {
      return request(app.getHttpServer())
        .get(`/bank/questions/${id}/preview`)
        .set("Authorization", `Bearer ${token}`);
    }

    async function createStructuredDraft(): Promise<string> {
      const id = await createDraftQuestion(tenantAId, tenantATeacherId);
      return id;
    }

    async function createImageQuestion(): Promise<string> {
      const response = await uploadRequest(tenantAToken)
        .field("courseId", courseId)
        .field("topicId", topicId)
        .field("difficulty", Difficulty.Easy)
        .field("gradeLevel", "primaria_1")
        .field("correctAnswer", "b")
        .attach("image", Buffer.from("fake-png-bytes"), "q.png")
        .expect(201);
      await trackCreatedQuestion(response.body.id);
      return response.body.id;
    }

    it("returns a PDF for a structured draft", async () => {
      const structuredDraftId = await createStructuredDraft();

      const res = await previewRequest(tenantAToken, structuredDraftId).expect(200);

      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(res.body.length).toBeGreaterThan(500);
    });

    it("400 for image questions", async () => {
      const imageQuestionId = await createImageQuestion();

      await previewRequest(tenantAToken, imageQuestionId).expect(400);
    });

    it("404 when the question belongs to another tenant", async () => {
      const tenantOnlyDraftId = await createStructuredDraft();
      await previewRequest(tenantBToken, tenantOnlyDraftId).expect(404);
    });

    it("404 for a non-existent question id", async () => {
      await previewRequest(tenantAToken, randomUUID()).expect(404);
    });

    it("serves a cached PDF on repeated requests, invalidated by PATCH", async () => {
      const id = await createStructuredDraft();

      const first = await previewRequest(tenantAToken, id).expect(200);
      const second = await previewRequest(tenantAToken, id).expect(200);
      expect(Buffer.compare(first.body, second.body)).toBe(0);

      await editRequest(tenantAToken, id).send({ bodyTypst: "cuerpo editado para preview" }).expect(200);

      const afterEdit = await previewRequest(tenantAToken, id).expect(200);
      expect(afterEdit.headers["content-type"]).toContain("application/pdf");
      expect(afterEdit.body.length).toBeGreaterThan(500);
    });
  });
});
