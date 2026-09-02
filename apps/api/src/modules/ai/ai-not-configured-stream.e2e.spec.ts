import { randomUUID } from "node:crypto";
import { Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { courses, tenants, topics, users } from "../../db/schema";
import { TokenService } from "../auth/token.service";

/**
 * A2 feature test (SSE variant of `ai-not-configured.e2e.spec.ts`): the
 * `POST /ai/questions/generate/stream` endpoint never throws an HTTP error —
 * per `AiController.generateStream`'s own docstring, every failure (AI
 * error, compile error, ...) is carried inside a 200 `done` frame's
 * `result.failed` instead of an HTTP error status. Before this fix that
 * meant `AiNotConfiguredError` degraded into an INDISTINGUISHABLE generic
 * failure message once it reached the stream — the client had no stable
 * signal to show "ask an operator to configure the AI provider" instead of
 * "try again". This pins that the failed item now carries
 * `code: "ai_not_configured"`.
 *
 * Deliberately does NOT override `QUESTION_GENERATOR_PORT` — same reasoning
 * as `ai-not-configured.e2e.spec.ts`: the whole point is exercising the REAL
 * `LazyQuestionGeneratorAdapter` -> `resolveQuestionGeneratorAdapter` ->
 * `resolveAiProviderConfig` chain when `AI_MODEL`/`AI_API_KEY`/
 * `OPENROUTER_API_KEY` are absent.
 */
describe("POST /ai/questions/generate/stream — AI not configured (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  let courseId: string;
  let topicId: string;
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

    const [course] = await db
      .insert(courses)
      .values({ name: `AI Stream Not Configured E2E Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `AI Stream Not Configured E2E Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [tenant] = await db
      .insert(tenants)
      .values({
        name: `AI Stream Not Configured E2E Tenant ${suffix}`,
        slug: `ai-stream-not-configured-e2e-${suffix}`,
      })
      .returning({ id: tenants.id });
    tenantId = tenant!.id;

    const [teacher] = await db
      .insert(users)
      .values({
        tenantId,
        email: `ai-stream-not-configured-e2e-teacher-${suffix}@exams-generator.test`,
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
    await db.delete(topics).where(inArray(topics.id, [topicId]));
    await db.delete(courses).where(inArray(courses.id, [courseId]));
    await app.close();
    await pool.end();

    if (savedAiModel !== undefined) process.env.AI_MODEL = savedAiModel;
    if (savedAiApiKey !== undefined) process.env.AI_API_KEY = savedAiApiKey;
    if (savedOpenRouterApiKey !== undefined) process.env.OPENROUTER_API_KEY = savedOpenRouterApiKey;
  });

  function parseFrames(text: string): Array<Record<string, unknown>> {
    return text
      .split("\n\n")
      .map((frame) => frame.trim())
      .filter((frame) => frame.startsWith("data:"))
      .map((frame) => JSON.parse(frame.slice("data:".length).trim()));
  }

  it('ends the SSE stream with a done frame whose failed item carries code: "ai_not_configured", not a generic 500', async () => {
    const response = await request(app.getHttpServer())
      .post("/ai/questions/generate/stream")
      .set("Authorization", `Bearer ${token}`)
      .send({ courseId, topicId, difficulty: "easy", gradeLevel: "primaria_1", withFigure: false })
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/event-stream");
    const frames = parseFrames(response.text);
    const last = frames[frames.length - 1];
    expect(last!.type).toBe("done");

    const result = last!.result as {
      created: unknown[];
      failed: Array<{ index: number; error: string; code?: string }>;
    };
    expect(result.created).toHaveLength(0);
    expect(result.failed).toEqual([
      expect.objectContaining({ index: 0, code: "ai_not_configured", error: expect.any(String) }),
    ]);
  });
});
