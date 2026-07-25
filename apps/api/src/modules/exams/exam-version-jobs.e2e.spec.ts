import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { waitForVersionJob } from "../../test-support/generate-versions";
import {
  assets,
  courses,
  examBlueprintRows,
  examQuestions,
  examVersionJobs,
  exams,
  examVersions,
  questions,
  tenants,
  topics,
  users,
} from "../../db/schema";
import { STORAGE_PORT } from "../bank/bank.constants";
import { TokenService } from "../auth/token.service";
import { StoragePort } from "./domain/ports/storage.port";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

/**
 * Queue-backed version generation e2e (audit P0). Covers the contract change
 * `POST /exams/:examId/versions` went through: it now returns 202 with a job
 * row and the real work happens in `ExamVersionJobsProcessor`, while every
 * synchronous rejection it used to return stays synchronous.
 */
describe("POST /exams/:examId/versions — queued generation (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;
  let storage: StoragePort;

  let courseId: string;
  let tenantAId: string;
  let tenantATeacherId: string;
  let tenantAToken: string;
  let tenantBId: string;
  let tenantBTeacherId: string;
  let tenantBToken: string;

  const createdTopicIds: string[] = [];
  const createdQuestionIds: string[] = [];
  const createdExamIds: string[] = [];

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
      .values({ name: `VersionJobsE2E Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `VersionJobsE2E Tenant A ${suffix}`, slug: `version-jobs-e2e-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `version-jobs-e2e-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantATeacherId = teacherA!.id;
    tenantAToken = tokenService.sign({ sub: tenantATeacherId, tenantId: tenantAId, role: Role.Teacher });

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `VersionJobsE2E Tenant B ${suffix}`, slug: `version-jobs-e2e-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;

    const [teacherB] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `version-jobs-e2e-b-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantBTeacherId = teacherB!.id;
    tenantBToken = tokenService.sign({ sub: tenantBTeacherId, tenantId: tenantBId, role: Role.Teacher });
  });

  afterAll(async () => {
    const cleanupSteps: Array<[string, () => Promise<unknown>]> = [
      [
        "delete exams",
        async () => {
          if (createdExamIds.length > 0) {
            await db.delete(examVersionJobs).where(inArray(examVersionJobs.examId, createdExamIds));
            await db.delete(examVersions).where(inArray(examVersions.examId, createdExamIds));
            await db.delete(examQuestions).where(inArray(examQuestions.examId, createdExamIds));
            await db.delete(examBlueprintRows).where(inArray(examBlueprintRows.examId, createdExamIds));
            await db.delete(exams).where(inArray(exams.id, createdExamIds));
          }
        },
      ],
      [
        "delete questions",
        async () => {
          if (createdQuestionIds.length > 0) {
            await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
          }
        },
      ],
      ["delete assets", () => db.delete(assets).where(inArray(assets.tenantId, [tenantAId, tenantBId]))],
      ["delete users", () => db.delete(users).where(inArray(users.id, [tenantATeacherId, tenantBTeacherId]))],
      ["delete tenants", () => db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))],
      [
        "delete topics",
        async () => {
          if (createdTopicIds.length > 0) {
            await db.delete(topics).where(inArray(topics.id, createdTopicIds));
          }
        },
      ],
      ["delete courses", () => db.delete(courses).where(eq(courses.id, courseId))],
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

  async function createTopic(): Promise<string> {
    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `VersionJobsE2E Topic ${randomUUID()}` })
      .returning({ id: topics.id });
    createdTopicIds.push(topic!.id);
    return topic!.id;
  }

  async function createApprovedQuestion(topicId: string, gradeLevel: string): Promise<void> {
    const storageKey = `version-jobs-e2e/${randomUUID()}`;
    await storage.put(storageKey, TINY_PNG, "image/png");

    const [asset] = await db
      .insert(assets)
      .values({ tenantId: tenantAId, storageKey, mime: "image/png" })
      .returning({ id: assets.id });

    const [question] = await db
      .insert(questions)
      .values({
        tenantId: tenantAId,
        type: "image",
        topicId,
        difficulty: Difficulty.Easy,
        gradeLevel,
        status: "approved",
        imageAssetId: asset!.id,
        correctAnswer: "a",
        createdBy: tenantATeacherId,
      })
      .returning({ id: questions.id });
    createdQuestionIds.push(question!.id);
  }

  async function createReadyExam(gradeLevel: string): Promise<string> {
    const topicId = await createTopic();
    await createApprovedQuestion(topicId, gradeLevel);

    const response = await request(app.getHttpServer())
      .post("/exams")
      .set("Authorization", `Bearer ${tenantAToken}`)
      .send({
        title: "Version jobs exam",
        gradeLevel,
        blueprint: [{ courseId, topicId, difficulty: Difficulty.Easy, count: 1 }],
      })
      .expect(201);
    createdExamIds.push(response.body.id);
    return response.body.id;
  }

  function postVersions(token: string, examId: string) {
    return request(app.getHttpServer())
      .post(`/exams/${examId}/versions`)
      .set("Authorization", `Bearer ${token}`);
  }

  it("responds 202 with a pending job, then the worker drives it to completed and the forms exist", async () => {
    const examId = await createReadyExam("primaria_1");

    const accepted = await postVersions(tenantAToken, examId).send({ versionCount: 2 }).expect(202);
    expect(accepted.body).toMatchObject({
      examId,
      versionCount: 2,
      status: "pending",
      completedCount: 0,
      failedReason: null,
    });

    const final = await waitForVersionJob(app, tenantAToken, examId, accepted.body.id);
    expect(final.status).toBe("completed");
    expect(final.completedCount).toBe(2);

    const versions = await request(app.getHttpServer())
      .get(`/exams/${examId}/versions`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);
    expect(versions.body.map((v: { code: string }) => v.code)).toEqual(["A", "B"]);
  });

  it("streams progress frames over SSE and closes the connection once the job is terminal", async () => {
    const examId = await createReadyExam("secundaria_1");
    const accepted = await postVersions(tenantAToken, examId).send({ versionCount: 2 }).expect(202);

    // The request resolves only when the API ends the response, which it
    // does at the terminal status — so this both proves the frames arrive
    // and that the stream does not hang open forever.
    const response = await request(app.getHttpServer())
      .get(`/exams/${examId}/versions/jobs/${accepted.body.id}/stream`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/event-stream");

    const frames = (response.text as string)
      .split("\n\n")
      .filter((frame) => frame.startsWith("data:"))
      .map((frame) => JSON.parse(frame.slice("data:".length).trim()) as { status: string; completedCount: number });

    expect(frames.length).toBeGreaterThan(0);
    const last = frames[frames.length - 1]!;
    expect(last.status).toBe("completed");
    expect(last.completedCount).toBe(2);
  });

  it("still rejects an out-of-range versionCount with 400, and never persists a job for it", async () => {
    const examId = await createReadyExam("primaria_2");

    await postVersions(tenantAToken, examId).send({ versionCount: 99 }).expect(400);

    const rows = await db.select().from(examVersionJobs).where(eq(examVersionJobs.examId, examId));
    expect(rows).toHaveLength(0);
  });

  it("still 404s an unknown exam before enqueuing anything", async () => {
    await postVersions(tenantAToken, randomUUID()).send({ versionCount: 1 }).expect(404);
  });

  it("GET .../jobs/:jobId is tenant-scoped — another tenant gets 404, not the job", async () => {
    const examId = await createReadyExam("primaria_3");
    const accepted = await postVersions(tenantAToken, examId).send({ versionCount: 1 }).expect(202);
    await waitForVersionJob(app, tenantAToken, examId, accepted.body.id);

    await request(app.getHttpServer())
      .get(`/exams/${examId}/versions/jobs/${accepted.body.id}`)
      .set("Authorization", `Bearer ${tenantBToken}`)
      .expect(404);
  });

  it("GET .../jobs/latest re-attaches to the newest job, and is null before anything was generated", async () => {
    const examId = await createReadyExam("primaria_4");

    const before = await request(app.getHttpServer())
      .get(`/exams/${examId}/versions/jobs/latest`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);
    // An exam that has never been generated is a valid state, not a 404.
    expect(before.body).toEqual({});

    const accepted = await postVersions(tenantAToken, examId).send({ versionCount: 1 }).expect(202);
    await waitForVersionJob(app, tenantAToken, examId, accepted.body.id);

    const after = await request(app.getHttpServer())
      .get(`/exams/${examId}/versions/jobs/latest`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);
    expect(after.body.id).toBe(accepted.body.id);
  });
});
