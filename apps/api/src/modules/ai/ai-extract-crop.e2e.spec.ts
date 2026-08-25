import { randomUUID } from "node:crypto";
import { Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import request from "supertest";
import Redis from "ioredis";
import sharp from "sharp";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { tenants, users } from "../../db/schema";
import { REDIS_CLIENT } from "../../common/redis.provider";
import { TokenService } from "../auth/token.service";
import { QUESTION_GENERATOR_PORT } from "./ai.constants";
import { QuestionGeneratorPort } from "./domain/ports/question-generator.port";

/**
 * Full HTTP e2e for the Task 6 crop-adjustment flow: `POST /ai/questions/extract`
 * caching the original photo, and `POST /ai/questions/extract/:extractionId/crop`
 * re-cutting it with a hand-drawn box. Overrides `QUESTION_GENERATOR_PORT` with a
 * fake that always reports a figure box (mirrors `ai-extract.e2e.spec.ts`) so this
 * suite never depends on `AI_MODEL`/`OPENROUTER_API_KEY`/network access. Uses real
 * PNG bytes and the real `sharp`-backed cropper — only the vision model is faked.
 */
describe("POST /ai/questions/extract/:extractionId/crop (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;
  let redis: Redis;

  let tenantId: string;
  let teacherId: string;
  let token: string;
  let otherTeacherId: string;
  let otherUserToken: string;

  /** Overrides the generator so it reports a figure box the cropper can act on. */
  const generatorWithFigureBox: jest.Mocked<QuestionGeneratorPort> = {
    generate: jest.fn(),
    reviseQuestion: jest.fn(),
    extractFromImage: jest.fn().mockResolvedValue({
      bodyTypst: "¿Qué muestra la figura?",
      alternatives: ["a", "b", "c", "d", "e"],
      correctAnswer: "a",
      figureBox: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
    }),
  };

  /** A real PNG — the crop path runs the real sharp adapter end to end. */
  async function realPng(): Promise<Buffer> {
    return sharp({ create: { width: 200, height: 100, channels: 3, background: "#ffffff" } })
      .png()
      .toBuffer();
  }

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(QUESTION_GENERATOR_PORT)
      .useValue(generatorWithFigureBox)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);
    redis = moduleRef.get<Redis>(REDIS_CLIENT);

    const suffix = randomUUID();

    const [tenant] = await db
      .insert(tenants)
      .values({ name: `AI Extract Crop E2E Tenant ${suffix}`, slug: `ai-extract-crop-e2e-tenant-${suffix}` })
      .returning({ id: tenants.id });
    tenantId = tenant!.id;

    const [teacher] = await db
      .insert(users)
      .values({
        tenantId,
        email: `ai-extract-crop-e2e-teacher-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    teacherId = teacher!.id;
    token = tokenService.sign({ sub: teacherId, tenantId, role: Role.Teacher });

    const [otherTeacher] = await db
      .insert(users)
      .values({
        tenantId,
        email: `ai-extract-crop-e2e-other-teacher-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    otherTeacherId = otherTeacher!.id;
    otherUserToken = tokenService.sign({ sub: otherTeacherId, tenantId, role: Role.Teacher });
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.id, [teacherId, otherTeacherId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantId]));
    // `app.close()` also quits the shared `REDIS_CLIENT` — see
    // `RedisModule.onModuleDestroy`.
    await app.close();
    await pool.end();
  });

  it("returns an extractionId and a figure crop, then re-crops with a hand-drawn box", async () => {
    const png = await realPng();

    const extracted = await request(app.getHttpServer())
      .post("/ai/questions/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", png, "question.png")
      .expect(200);

    expect(extracted.body.extractionId).toEqual(expect.any(String));
    expect(extracted.body.figureCrop.dataUrl).toMatch(/^data:image\/png;base64,/);

    const recropped = await request(app.getHttpServer())
      .post(`/ai/questions/extract/${extracted.body.extractionId}/crop`)
      .set("Authorization", `Bearer ${token}`)
      .send({ box: { x: 0, y: 0, w: 0.25, h: 0.25 } })
      .expect(200);

    expect(recropped.body.box).toEqual({ x: 0, y: 0, w: 0.25, h: 0.25 });
    expect(recropped.body.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("returns 410 once the cached photo is gone", async () => {
    // Same flow, but the cache entry is deleted before the re-crop.
    const png = await realPng();
    const extracted = await request(app.getHttpServer())
      .post("/ai/questions/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", png, "question.png")
      .expect(200);

    await redis.del(`ai:extract:${extracted.body.extractionId}`);

    await request(app.getHttpServer())
      .post(`/ai/questions/extract/${extracted.body.extractionId}/crop`)
      .set("Authorization", `Bearer ${token}`)
      .send({ box: { x: 0, y: 0, w: 0.25, h: 0.25 } })
      .expect(410);
  });

  it("returns the same 410 as an unknown id for another account's extractionId, so the response cannot confirm the id exists", async () => {
    const png = await realPng();
    const extracted = await request(app.getHttpServer())
      .post("/ai/questions/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", png, "question.png")
      .expect(200);

    await request(app.getHttpServer())
      .post(`/ai/questions/extract/${extracted.body.extractionId}/crop`)
      .set("Authorization", `Bearer ${otherUserToken}`)
      .send({ box: { x: 0, y: 0, w: 0.25, h: 0.25 } })
      .expect(410);
  });
});
