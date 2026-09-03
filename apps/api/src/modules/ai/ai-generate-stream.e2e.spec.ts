import { randomUUID } from "node:crypto";
import { Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { courses, questions, tenants, topics, users } from "../../db/schema";
import { TokenService } from "../auth/token.service";
import { isTypstAvailableSync } from "../exams/adapters/pdf/test-utils/typst-availability";
import { InMemoryQuestionGeneratorAdapter } from "./adapters/in-memory-question-generator.adapter";
import { QUESTION_GENERATOR_PORT } from "./ai.constants";

const describeIfTypst = isTypstAvailableSync() ? describe : describe.skip;

describeIfTypst("POST /ai/questions/generate/stream (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  let courseId: string;
  let topicId: string;
  let tenantId: string;
  let teacherId: string;
  let token: string;

  const createdQuestionIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(QUESTION_GENERATOR_PORT)
      .useValue(new InMemoryQuestionGeneratorAdapter())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    const suffix = randomUUID();

    const [course] = await db
      .insert(courses)
      .values({ name: `AI Stream E2E Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `AI Stream E2E Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [tenant] = await db
      .insert(tenants)
      .values({ name: `AI Stream E2E Tenant ${suffix}`, slug: `ai-stream-e2e-tenant-${suffix}` })
      .returning({ id: tenants.id });
    tenantId = tenant!.id;

    const [teacher] = await db
      .insert(users)
      .values({
        tenantId,
        email: `ai-stream-e2e-teacher-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    teacherId = teacher!.id;

    token = tokenService.sign({ sub: teacherId, tenantId, role: Role.Teacher });
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
      ["delete users", () => db.delete(users).where(inArray(users.id, [teacherId]))],
      ["delete tenants", () => db.delete(tenants).where(inArray(tenants.id, [tenantId]))],
      ["delete topics", () => db.delete(topics).where(inArray(topics.id, [topicId]))],
      ["delete courses", () => db.delete(courses).where(inArray(courses.id, [courseId]))],
      ["close app", () => app.close()],
    ];
    for (const [label, step] of cleanupSteps) {
      try {
        await step();
      } catch (err) {
        console.error(`[afterAll cleanup] "${label}" failed, continuing with remaining steps:`, err);
      }
    }
    await pool.end();
  });

  function parseFrames(text: string): Array<Record<string, unknown>> {
    return text
      .split("\n\n")
      .map((frame) => frame.trim())
      .filter((frame) => frame.startsWith("data:"))
      .map((frame) => JSON.parse(frame.slice("data:".length).trim()));
  }

  it("streams a text/event-stream response ending in a done event with a created id", async () => {
    const response = await request(app.getHttpServer())
      .post("/ai/questions/generate/stream")
      .set("Authorization", `Bearer ${token}`)
      .send({ courseId, topicId, difficulty: "easy", gradeLevel: "primaria_1", withFigure: false })
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/event-stream");
    const frames = parseFrames(response.text);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.some((f) => f.type === "delta")).toBe(true);
    const last = frames[frames.length - 1];
    expect(last.type).toBe("done");
    const result = last.result as { created: Array<{ id: string }>; failed: unknown[] };
    expect(result.created).toHaveLength(1);
    createdQuestionIds.push(result.created[0]!.id);
  });

  it("rejects with 401 when no Authorization header is sent", async () => {
    await request(app.getHttpServer())
      .post("/ai/questions/generate/stream")
      .send({ courseId, topicId, difficulty: "easy", gradeLevel: "primaria_1" })
      .expect(401);
  });
});
