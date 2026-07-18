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
  let tenantBId: string;
  let tenantBTeacherId: string;

  let staffToken: string;
  let tenantAToken: string;
  let tenantBToken: string;

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
    tenantBToken = tokenService.sign({ sub: tenantBTeacherId, tenantId: tenantBId, role: Role.Teacher });
  });

  afterAll(async () => {
    if (createdQuestionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
    }
    if (createdAssetIds.length > 0) {
      await db.delete(assets).where(inArray(assets.id, createdAssetIds));
    }
    await db.delete(users).where(inArray(users.id, [staffUserId, tenantATeacherId, tenantBTeacherId]));
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

  function listRequest(token: string) {
    return request(app.getHttpServer())
      .get("/bank/questions")
      .set("Authorization", `Bearer ${token}`);
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
});
