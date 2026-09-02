import { randomUUID } from "node:crypto";
import { Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { fakePng } from "../../test-support/image-fixtures";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { tenants, users } from "../../db/schema";
import { TokenService } from "../auth/token.service";

/**
 * A2 feature test: missing AI configuration must answer 503 with a stable
 * `code`, not the generic 500 `AllExceptionsFilter` would otherwise produce
 * for a plain `Error`. Deliberately does NOT override `QUESTION_GENERATOR_PORT`
 * — every other AI e2e suite does, precisely to avoid depending on real AI
 * env vars, but THIS suite's whole point is exercising the REAL
 * `LazyQuestionGeneratorAdapter` -> `resolveQuestionGeneratorAdapter` ->
 * `resolveAiProviderConfig` chain when `AI_MODEL`/`AI_API_KEY`/
 * `OPENROUTER_API_KEY` are absent.
 *
 * `AI_MODEL`/`AI_API_KEY`/`OPENROUTER_API_KEY` are deleted from
 * `process.env` in `beforeAll`, before the app boots — `LazyQuestionGeneratorAdapter`
 * only resolves (and only then reads `process.env`) on the FIRST port call,
 * so this never crashes app bootstrap (that laziness is the whole reason it
 * exists) and only bites the first `/ai/questions/extract` call this suite
 * makes.
 */
describe("POST /ai/questions/extract — AI not configured (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  let tenantId: string;
  let teacherId: string;
  let token: string;

  let savedAiModel: string | undefined;
  let savedAiApiKey: string | undefined;
  let savedOpenRouterApiKey: string | undefined;

  beforeAll(async () => {
    savedAiModel = process.env.AI_MODEL;
    savedAiApiKey = process.env.AI_API_KEY;
    savedOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
    delete process.env.AI_MODEL;
    delete process.env.AI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    await runMigrations();

    // No `.overrideProvider(QUESTION_GENERATOR_PORT)` — see this file's
    // docstring for why the REAL lazy adapter must be exercised here.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    const suffix = randomUUID();

    const [tenant] = await db
      .insert(tenants)
      .values({ name: `AI Not Configured E2E Tenant ${suffix}`, slug: `ai-not-configured-e2e-${suffix}` })
      .returning({ id: tenants.id });
    tenantId = tenant!.id;

    const [teacher] = await db
      .insert(users)
      .values({
        tenantId,
        email: `ai-not-configured-e2e-teacher-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    teacherId = teacher!.id;

    token = tokenService.sign({ sub: teacherId, tenantId, role: Role.Teacher });
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.id, [teacherId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantId]));
    await app.close();
    await pool.end();

    if (savedAiModel !== undefined) process.env.AI_MODEL = savedAiModel;
    if (savedAiApiKey !== undefined) process.env.AI_API_KEY = savedAiApiKey;
    if (savedOpenRouterApiKey !== undefined) process.env.OPENROUTER_API_KEY = savedOpenRouterApiKey;
  });

  it("returns 503 with code: ai_not_configured instead of a generic 500, when AI_MODEL/AI_API_KEY are unset", async () => {
    const response = await request(app.getHttpServer())
      .post("/ai/questions/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", fakePng(), { filename: "q.png", contentType: "image/png" })
      .expect(503);

    expect(response.body).toMatchObject({ statusCode: 503, code: "ai_not_configured" });
    expect(response.body.message).toEqual(expect.any(String));
  });
});
