import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { fakePng } from "../../test-support/image-fixtures";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { assets, courses, questions, tenants, topics, users } from "../../db/schema";
import { TokenService } from "../auth/token.service";

/**
 * Full HTTP e2e for `POST /bank/questions/:id/image` — swaps a question's
 * backing image asset (Task 2, question-editing design). Works for both
 * `type='image'` (the whole question) and `type='structured'` (an optional
 * complement image). Separate file from `bank.e2e.spec.ts` (same convention
 * as `bank-edit-approved.e2e.spec.ts`) to keep its own minimal fixture set:
 * one course/topic, two tenants, one teacher each.
 */
describe("Bank module — replace image question's image (e2e)", () => {
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

  const createdQuestionIds: string[] = [];
  const createdAssetIds: string[] = [];

  const pngBuffer = fakePng();
  const replacementPngBuffer = fakePng("fake-replacement-png-bytes");

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    const suffix = randomUUID();

    const [course] = await db
      .insert(courses)
      .values({ name: `E2E Replace Image Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `E2E Replace Image Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `E2E Replace Image Tenant A ${suffix}`, slug: `e2e-replace-image-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `e2e-replace-image-teacher-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantATeacherId = teacherA!.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `E2E Replace Image Tenant B ${suffix}`, slug: `e2e-replace-image-tenant-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;

    const [teacherB] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `e2e-replace-image-teacher-b-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantBTeacherId = teacherB!.id;

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
    await db.delete(users).where(inArray(users.id, [tenantATeacherId, tenantBTeacherId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]));
    await db.delete(topics).where(inArray(topics.id, [topicId]));
    await db.delete(courses).where(inArray(courses.id, [courseId]));
    await app.close();
    await pool.end();
  });

  function replaceImageRequest(token: string, id: string) {
    return request(app.getHttpServer())
      .post(`/bank/questions/${id}/image`)
      .set("Authorization", `Bearer ${token}`);
  }

  function getByIdRequest(token: string, id: string) {
    return request(app.getHttpServer())
      .get(`/bank/questions/${id}`)
      .set("Authorization", `Bearer ${token}`);
  }

  async function trackAssetForQuestion(id: string): Promise<void> {
    const [row] = await db
      .select({ imageAssetId: questions.imageAssetId })
      .from(questions)
      .where(inArray(questions.id, [id]));
    if (row?.imageAssetId) {
      createdAssetIds.push(row.imageAssetId);
    }
  }

  async function createImageQuestion(token: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/bank/questions/image")
      .set("Authorization", `Bearer ${token}`)
      .field("courseId", courseId)
      .field("topicId", topicId)
      .field("difficulty", Difficulty.Easy)
      .field("gradeLevel", "primaria_1")
      .field("correctAnswer", "b")
      .attach("image", pngBuffer, "q.png")
      .expect(201);
    const id = response.body.id as string;
    createdQuestionIds.push(id);
    await trackAssetForQuestion(id);
    return id;
  }

  async function createStructuredQuestion(token: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/bank/questions/structured")
      .set("Authorization", `Bearer ${token}`)
      .send({
        courseId,
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        bodyTypst: "pregunta estructurada para replace-image tests",
        alternatives: ["a", "b"],
        correctAnswer: "0",
      })
      .expect(201);
    createdQuestionIds.push(response.body.id);
    return response.body.id;
  }

  it("swaps an OWN image question's imageAssetId, reflected on a follow-up GET", async () => {
    const id = await createImageQuestion(tenantAToken);
    const before = await getByIdRequest(tenantAToken, id).expect(200);

    const replaced = await replaceImageRequest(tenantAToken, id)
      .attach("file", replacementPngBuffer, { filename: "new.png", contentType: "image/png" })
      .expect(201);
    expect(replaced.body.id).toBe(id);

    const after = await getByIdRequest(tenantAToken, id).expect(200);
    await trackAssetForQuestion(id);

    expect(after.body.imageAssetId).toBeDefined();
    expect(after.body.imageAssetId).not.toBe(before.body.imageAssetId);
  });

  it("attaches a complement image to a structured question, reflected on a follow-up GET", async () => {
    const id = await createStructuredQuestion(tenantAToken);
    const before = await getByIdRequest(tenantAToken, id).expect(200);
    expect(before.body.imageAssetId).toBeNull();

    const replaced = await replaceImageRequest(tenantAToken, id)
      .attach("file", replacementPngBuffer, { filename: "new.png", contentType: "image/png" })
      .expect(201);
    expect(replaced.body.id).toBe(id);

    const after = await getByIdRequest(tenantAToken, id).expect(200);
    await trackAssetForQuestion(id);

    expect(after.body.imageAssetId).toBeDefined();
    expect(after.body.imageAssetId).not.toBeNull();
  });

  it("404 when replacing the image of another tenant's question", async () => {
    const id = await createImageQuestion(tenantAToken);

    await replaceImageRequest(tenantBToken, id)
      .attach("file", replacementPngBuffer, { filename: "new.png", contentType: "image/png" })
      .expect(404);
  });
});
