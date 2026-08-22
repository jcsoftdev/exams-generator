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
 * Full HTTP e2e for the "edit approved questions + taxonomy" extension of
 * `PATCH /bank/questions/:id` (design doc: question editing). Separate file
 * from `bank.e2e.spec.ts` (rather than appended to its "archive & delete"
 * describe block) to keep its own minimal fixture set — only what this
 * behavior needs: one tenant, one teacher, an approved structured question,
 * and an archived one.
 */
describe("Bank module — edit approved questions + taxonomy (e2e)", () => {
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

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    const suffix = randomUUID();

    const [course] = await db
      .insert(courses)
      .values({ name: `E2E Edit Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `E2E Edit Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `E2E Edit Tenant A ${suffix}`, slug: `e2e-edit-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `e2e-edit-teacher-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantATeacherId = teacherA!.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `E2E Edit Tenant B ${suffix}`, slug: `e2e-edit-tenant-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;

    const [teacherB] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `e2e-edit-teacher-b-${suffix}@exams-generator.test`,
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

  function editRequest(token: string, id: string) {
    return request(app.getHttpServer())
      .patch(`/bank/questions/${id}`)
      .set("Authorization", `Bearer ${token}`);
  }

  function getByIdRequest(token: string, id: string) {
    return request(app.getHttpServer()).get(`/bank/questions/${id}`).set("Authorization", `Bearer ${token}`);
  }

  async function createApprovedQuestion(token: string, bodyTypst?: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/bank/questions/structured")
      .set("Authorization", `Bearer ${token}`)
      .send({
        courseId,
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        bodyTypst: bodyTypst ?? `pregunta aprobada para edit tests ${randomUUID()}`,
        alternatives: ["a", "b"],
        correctAnswer: "0",
      })
      .expect(201);
    createdQuestionIds.push(response.body.id);
    return response.body.id;
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
      .attach("image", fakePng(), "q.png")
      .expect(201);
    const id = response.body.id as string;
    createdQuestionIds.push(id);
    const [row] = await db
      .select({ imageAssetId: questions.imageAssetId })
      .from(questions)
      .where(inArray(questions.id, [id]));
    if (row?.imageAssetId) {
      createdAssetIds.push(row.imageAssetId);
    }
    return id;
  }

  async function createArchivedQuestion(token: string): Promise<string> {
    const id = await createApprovedQuestion(token);
    await request(app.getHttpServer())
      .patch(`/bank/questions/${id}/archive`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    return id;
  }

  it("edits an OWN approved question's content + taxonomy, reflected on a follow-up GET", async () => {
    const id = await createApprovedQuestion(tenantAToken);

    const edited = await editRequest(tenantAToken, id)
      .send({ bodyTypst: "Nuevo enunciado $2+2$", difficulty: "hard" })
      .expect(200);
    expect(edited.body.status).toBe("approved");

    const fetched = await getByIdRequest(tenantAToken, id).expect(200);
    expect(fetched.body.bodyTypst).toBe("Nuevo enunciado $2+2$");
    expect(fetched.body.difficulty).toBe("hard");
  });

  it("edits an OWN image question's difficulty + correctAnswer LETTER, reflected on a follow-up GET (no Typst compile)", async () => {
    const id = await createImageQuestion(tenantAToken);

    const edited = await editRequest(tenantAToken, id)
      .send({ difficulty: "hard", correctAnswer: "c" })
      .expect(200);
    expect(edited.body.status).toBe("approved");
    expect(edited.body.type).toBe("image");

    const fetched = await getByIdRequest(tenantAToken, id).expect(200);
    expect(fetched.body.difficulty).toBe("hard");
    // Image questions keep a LETTER correctAnswer (the marked option), never a 0-based index.
    expect(fetched.body.correctAnswer).toBe("c");
  });

  it("404 when editing an image question belonging to another tenant", async () => {
    const id = await createImageQuestion(tenantAToken);

    await editRequest(tenantBToken, id).send({ difficulty: "hard", correctAnswer: "d" }).expect(404);
  });

  it("404 when editing an approved question belonging to another tenant", async () => {
    const id = await createApprovedQuestion(tenantAToken);

    await editRequest(tenantBToken, id).send({ bodyTypst: "hacked", difficulty: "hard" }).expect(404);
  });

  it("409 when editing an archived question", async () => {
    const id = await createArchivedQuestion(tenantAToken);

    await editRequest(tenantAToken, id).send({ bodyTypst: "no debería aplicar" }).expect(409);
  });

  it("4xx on a nonexistent topicId, and leaves the question's content untouched (atomic — no partial write)", async () => {
    const originalBody = `pregunta original intacta ${randomUUID()}`;
    const id = await createApprovedQuestion(tenantAToken, originalBody);
    const bogusTopicId = randomUUID();

    const response = await editRequest(tenantAToken, id).send({
      bodyTypst: "este cambio NO debería persistir",
      topicId: bogusTopicId,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);

    const fetched = await getByIdRequest(tenantAToken, id).expect(200);
    expect(fetched.body.bodyTypst).toBe(originalBody);
    expect(fetched.body.alternatives).toEqual(["a", "b"]);
    expect(fetched.body.topicId).toBe(topicId);
  });
});
