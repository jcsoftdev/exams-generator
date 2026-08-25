import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { asc, eq, inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { fakePng } from "../../test-support/image-fixtures";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import {
  assets,
  courses,
  questionAlternativeImages,
  questions,
  tenants,
  topics,
  users,
} from "../../db/schema";
import { TokenService } from "../auth/token.service";
import { STORAGE_PORT } from "./bank.constants";
import { StoragePort } from "../exams/domain/ports/storage.port";

/**
 * Full HTTP e2e for `POST /bank/questions/:id/alternative-images` — attaches
 * one image per alternative slot of a `type='structured'` question. Sibling
 * to `bank-replace-image.e2e.spec.ts` (same fixture shape: one course/topic,
 * two tenants, one teacher each), kept in its own file for the same reason.
 */
describe("Bank module — set structured question alternative images (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;
  let storage: StoragePort;

  let courseId: string;
  let topicId: string;
  let tenantAId: string;
  let tenantATeacherId: string;
  let tenantBId: string;
  let tenantBTeacherId: string;

  let tenantAToken: string;
  let tenantBToken: string;

  const createdQuestionIds: string[] = [];

  const altPngA = fakePng("fake-alt-png-a");
  const altPngB = fakePng("fake-alt-png-b");
  const altPngC = fakePng("fake-alt-png-c");

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
      .values({ name: `E2E Alt Images Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `E2E Alt Images Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `E2E Alt Images Tenant A ${suffix}`, slug: `e2e-alt-images-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `e2e-alt-images-teacher-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantATeacherId = teacherA!.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `E2E Alt Images Tenant B ${suffix}`, slug: `e2e-alt-images-tenant-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;

    const [teacherB] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `e2e-alt-images-teacher-b-${suffix}@exams-generator.test`,
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
      const altImageRows = await db
        .select({ assetId: questionAlternativeImages.assetId })
        .from(questionAlternativeImages)
        .where(inArray(questionAlternativeImages.questionId, createdQuestionIds));
      await db
        .delete(questionAlternativeImages)
        .where(inArray(questionAlternativeImages.questionId, createdQuestionIds));
      const assetIds = altImageRows.map((row) => row.assetId);
      if (assetIds.length > 0) {
        await db.delete(assets).where(inArray(assets.id, assetIds));
      }
      await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
    }
    await db.delete(users).where(inArray(users.id, [tenantATeacherId, tenantBTeacherId]));
    // Every asset these tenants own, not just the ones reached through
    // `question_alternative_images` above: the image questions this file
    // uploads each carry their own `image_asset_id`, and `assets.tenant_id`
    // has an FK to `tenants`, so leaving them behind made the tenant delete
    // below fail and took the whole suite down in teardown.
    await db.delete(assets).where(inArray(assets.tenantId, [tenantAId, tenantBId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]));
    await db.delete(topics).where(inArray(topics.id, [topicId]));
    await db.delete(courses).where(inArray(courses.id, [courseId]));
    await app.close();
    await pool.end();
  });

  function setAlternativeImagesRequest(token: string, id: string) {
    return request(app.getHttpServer())
      .post(`/bank/questions/${id}/alternative-images`)
      .set("Authorization", `Bearer ${token}`);
  }

  async function createStructuredQuestion(token: string, alternatives: string[]): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/bank/questions/structured")
      .set("Authorization", `Bearer ${token}`)
      .send({
        courseId,
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        bodyTypst: `pregunta estructurada alt-images ${randomUUID()}`,
        alternatives,
        correctAnswer: "0",
      })
      .expect(201);
    const id = response.body.id as string;
    createdQuestionIds.push(id);
    return id;
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
    return id;
  }

  it("attaches one image per alternative, index-aligned, and persists them ordered by alternative_index", async () => {
    const id = await createStructuredQuestion(tenantAToken, ["a", "b", "c"]);

    const response = await setAlternativeImagesRequest(tenantAToken, id)
      .attach("images", altPngA, "alt-a.png")
      .attach("images", altPngB, "alt-b.png")
      .attach("images", altPngC, "alt-c.png")
      .expect(201);

    expect(response.body.id).toBe(id);

    const rows = await db
      .select({ alternativeIndex: questionAlternativeImages.alternativeIndex })
      .from(questionAlternativeImages)
      .where(eq(questionAlternativeImages.questionId, id))
      .orderBy(asc(questionAlternativeImages.alternativeIndex));

    expect(rows.map((row) => row.alternativeIndex)).toEqual([0, 1, 2]);
  });

  it("attaches images to a SPARSE, non-contiguous set of alternative slots (indexes), and the right image lands at the right slot", async () => {
    // 5-alternative structured question, matching spec §10's "indexes
    // esparso" scenario (a drawing sits on only SOME alternatives) — the
    // full HTTP round trip is what unit tests structurally cannot cover:
    // `append-field` producing `["0","2"]` for a repeated multipart field is
    // already unit-tested, and so is `@Body()` on a multipart route
    // elsewhere in this repo, but neither proves the file-to-index
    // positional pairing survives an ACTUAL request.
    const id = await createStructuredQuestion(tenantAToken, ["a", "b", "c", "d", "e"]);
    // Distinct bytes per image (fakePng's `tag` argument), so a positional
    // swap between slot 0 and slot 2 is detectable by content, not just by
    // row count.
    const imageForSlot0 = fakePng(`sparse-slot-0-${randomUUID()}`);
    const imageForSlot2 = fakePng(`sparse-slot-2-${randomUUID()}`);

    const response = await setAlternativeImagesRequest(tenantAToken, id)
      .field("indexes", "0")
      .field("indexes", "2")
      .attach("images", imageForSlot0, "slot-0.png")
      .attach("images", imageForSlot2, "slot-2.png")
      .expect(201);

    expect(response.body.id).toBe(id);

    const rows = await db
      .select({
        alternativeIndex: questionAlternativeImages.alternativeIndex,
        storageKey: assets.storageKey,
      })
      .from(questionAlternativeImages)
      .innerJoin(assets, eq(questionAlternativeImages.assetId, assets.id))
      .where(eq(questionAlternativeImages.questionId, id))
      .orderBy(asc(questionAlternativeImages.alternativeIndex));

    // Sparse: exactly the two named slots, nothing at 1, 3 or 4.
    expect(rows.map((row) => row.alternativeIndex)).toEqual([0, 2]);

    const [slot0, slot2] = rows;
    const slot0Bytes = await storage.get(slot0!.storageKey);
    const slot2Bytes = await storage.get(slot2!.storageKey);

    // Byte-for-byte, not just row count — this is what catches a swap.
    expect(slot0Bytes.equals(imageForSlot0)).toBe(true);
    expect(slot2Bytes.equals(imageForSlot2)).toBe(true);
    expect(slot0Bytes.equals(imageForSlot2)).toBe(false);
  });

  it("re-attaching REPLACES the full previous set instead of accumulating rows", async () => {
    const id = await createStructuredQuestion(tenantAToken, ["a", "b"]);

    await setAlternativeImagesRequest(tenantAToken, id)
      .attach("images", altPngA, "alt-a.png")
      .attach("images", altPngB, "alt-b.png")
      .expect(201);

    await setAlternativeImagesRequest(tenantAToken, id)
      .attach("images", altPngB, "new-alt-a.png")
      .attach("images", altPngA, "new-alt-b.png")
      .expect(201);

    const rows = await db
      .select({ alternativeIndex: questionAlternativeImages.alternativeIndex })
      .from(questionAlternativeImages)
      .where(eq(questionAlternativeImages.questionId, id));

    expect(rows).toHaveLength(2);
  });

  it("400 when the number of uploaded images does not match the number of alternatives", async () => {
    const id = await createStructuredQuestion(tenantAToken, ["a", "b", "c"]);

    await setAlternativeImagesRequest(tenantAToken, id)
      .attach("images", altPngA, "alt-a.png")
      .attach("images", altPngB, "alt-b.png")
      .expect(400);
  });

  it("rejects an `image`-type question — alternative images only apply to structured questions", async () => {
    const id = await createImageQuestion(tenantAToken);

    await setAlternativeImagesRequest(tenantAToken, id).attach("images", altPngA, "alt-a.png").expect(400);
  });

  it("404 when setting alternative images on another tenant's question", async () => {
    const id = await createStructuredQuestion(tenantAToken, ["a", "b"]);

    await setAlternativeImagesRequest(tenantBToken, id)
      .attach("images", altPngA, "alt-a.png")
      .attach("images", altPngB, "alt-b.png")
      .expect(404);
  });
});
