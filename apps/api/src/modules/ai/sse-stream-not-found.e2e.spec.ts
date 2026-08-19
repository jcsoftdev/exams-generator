import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db } from "../../db/client";
import { examVersionJobs, exams, generationJobs } from "../../db/schema";
import { TokenService } from "../auth/token.service";
import {
  closeDbPool,
  createTenantFixture,
  createUserFixture,
  deleteTenantFixture,
  deleteTopicAndCourseFixture,
  deleteUserFixture,
  ensureGradeLevelsSeeded,
  ensureMigrated,
  ensureTopicFixture,
  TenantFixture,
  TopicFixture,
  UserFixture,
} from "../../test-utils/db-fixtures";

/**
 * P0 regression: both hand-rolled SSE routes used to call
 * `res.flushHeaders()` BEFORE their tenant-scoped lookup. An unknown (or
 * cross-tenant) job id therefore put a `200 OK` status line on the wire and
 * only THEN threw `NotFoundException` — at which point `AllExceptionsFilter`
 * tried `res.status(404).json(...)` on an already-started response, throwing
 * `ERR_HTTP_HEADERS_SENT` from inside the filter itself. Unhandled, that
 * killed the whole API process: any authenticated user opening a stale link
 * took the school offline.
 *
 * The contract asserted here is deliberately blunt and end-to-end: a bogus
 * id gets a real 404, a cross-tenant id never gets a 200, and the app is
 * still answering requests afterwards.
 */
describe("SSE job streams — unknown/cross-tenant id (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  let topic: TopicFixture;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let teacherA: UserFixture;
  let teacherB: UserFixture;
  let tokenA: string;
  let tokenB: string;

  let generationJobBId: string;
  let examBId: string;
  let examVersionJobBId: string;

  const MISSING_ID = "00000000-0000-0000-0000-000000000000";

  beforeAll(async () => {
    await ensureMigrated();
    await ensureGradeLevelsSeeded();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    topic = await ensureTopicFixture();
    tenantA = await createTenantFixture();
    tenantB = await createTenantFixture();
    teacherA = await createUserFixture({ role: Role.Teacher, tenantId: tenantA.id });
    teacherB = await createUserFixture({ role: Role.Teacher, tenantId: tenantB.id });
    tokenA = tokenService.sign({ sub: teacherA.id, tenantId: tenantA.id, role: Role.Teacher });
    tokenB = tokenService.sign({ sub: teacherB.id, tenantId: tenantB.id, role: Role.Teacher });

    const [generationJobB] = await db
      .insert(generationJobs)
      .values({
        tenantId: tenantB.id,
        createdBy: teacherB.id,
        createdByRole: Role.Teacher,
        courseId: topic.courseId,
        topicId: topic.id,
        difficulty: Difficulty.Easy,
        gradeLevel: "secundaria_5",
        count: 1,
        status: "completed",
      })
      .returning({ id: generationJobs.id });
    generationJobBId = generationJobB!.id;

    const [examB] = await db
      .insert(exams)
      .values({
        tenantId: tenantB.id,
        title: `SSE 404 E2E Exam ${randomUUID()}`,
        gradeLevel: "secundaria_5",
        createdBy: teacherB.id,
      })
      .returning({ id: exams.id });
    examBId = examB!.id;

    const [examVersionJobB] = await db
      .insert(examVersionJobs)
      .values({
        tenantId: tenantB.id,
        examId: examBId,
        createdBy: teacherB.id,
        createdByRole: Role.Teacher,
        versionCount: 1,
        status: "completed",
      })
      .returning({ id: examVersionJobs.id });
    examVersionJobBId = examVersionJobB!.id;
  });

  afterAll(async () => {
    await db.delete(examVersionJobs).where(eq(examVersionJobs.id, examVersionJobBId));
    await db.delete(exams).where(eq(exams.id, examBId));
    await db.delete(generationJobs).where(inArray(generationJobs.tenantId, [tenantA.id, tenantB.id]));
    await deleteUserFixture(teacherA.id);
    await deleteUserFixture(teacherB.id);
    await deleteTenantFixture(tenantA.id);
    await deleteTenantFixture(tenantB.id);
    await deleteTopicAndCourseFixture(topic);
    await app.close();
    await closeDbPool();
  });

  describe("GET /ai/questions/jobs/:id/stream", () => {
    it("answers 404 (not 200) for a job id that does not exist, and the app survives it", async () => {
      const res = await request(app.getHttpServer())
        .get(`/ai/questions/jobs/${MISSING_ID}/stream`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.headers["content-type"]).not.toContain("text/event-stream");
      expect(res.text).not.toContain("data:");

      // The whole point of the bug: the process used to be gone by now.
      const health = await request(app.getHttpServer()).get("/health");
      expect(health.status).toBe(200);
    });

    it("answers 404 for another school's job id — never 200, never a frame", async () => {
      const res = await request(app.getHttpServer())
        .get(`/ai/questions/jobs/${generationJobBId}/stream`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.text).not.toContain("data:");
      expect(res.text).not.toContain(tenantB.id);

      const health = await request(app.getHttpServer()).get("/health");
      expect(health.status).toBe(200);
    });

    it("positive control: the owning school still gets a 200 SSE stream", async () => {
      const res = await request(app.getHttpServer())
        .get(`/ai/questions/jobs/${generationJobBId}/stream`)
        .set("Authorization", `Bearer ${tokenB}`)
        .buffer(true);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/event-stream");
      expect(res.text).toContain(generationJobBId);
    });
  });

  describe("GET /exams/:examId/versions/jobs/:jobId/stream", () => {
    it("answers 404 (not 200) for a job id that does not exist, and the app survives it", async () => {
      const res = await request(app.getHttpServer())
        .get(`/exams/${examBId}/versions/jobs/${MISSING_ID}/stream`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
      expect(res.headers["content-type"]).not.toContain("text/event-stream");
      expect(res.text).not.toContain("data:");

      const health = await request(app.getHttpServer()).get("/health");
      expect(health.status).toBe(200);
    });

    it("answers 404 for another school's version job id — never 200, never a frame", async () => {
      const res = await request(app.getHttpServer())
        .get(`/exams/${examBId}/versions/jobs/${examVersionJobBId}/stream`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.text).not.toContain("data:");
      expect(res.text).not.toContain(tenantB.id);

      const health = await request(app.getHttpServer()).get("/health");
      expect(health.status).toBe(200);
    });

    it("positive control: the owning school still gets a 200 SSE stream", async () => {
      const res = await request(app.getHttpServer())
        .get(`/exams/${examBId}/versions/jobs/${examVersionJobBId}/stream`)
        .set("Authorization", `Bearer ${tokenB}`)
        .buffer(true);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/event-stream");
      expect(res.text).toContain(examVersionJobBId);
    });
  });
});
