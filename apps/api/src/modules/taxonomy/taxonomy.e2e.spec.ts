import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Role } from "@exams-generator/shared";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { courses, examTypes, topics, tracks, universities } from "../../db/schema";
import { createUserFixture, deleteUserFixture } from "../../test-utils/db-fixtures";
import { TokenService } from "../auth/token.service";

/**
 * Full HTTP e2e for `GET /courses` and `GET /topics` — both routes are
 * read-only global-catalog lookups behind `JwtAuthGuard` only (any
 * authenticated role, no `RolesGuard`/`TenantGuard`, matching the `ai`
 * module's convention for endpoints with no tenant-scoping concern).
 */
describe("Taxonomy endpoints (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;
  let token: string;

  let courseAId: string;
  let courseBId: string;
  let topicAId: string;
  let topicBId: string;
  let readerId: string;
  let testFactoryCourseId: string;
  /**
   * Dash-free on purpose: `GET /courses` now hides any course whose name
   * carries a UUID fragment (audit 2026-08-20, H1), so a fixture that has to
   * be VISIBLE cannot be named the way a test factory names one. Unique per
   * run all the same, and deleted by id in `afterAll`.
   */
  const suffix = randomUUID().replace(/-/g, "");

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    // A real user row, not a fabricated id: the guard now refuses a token whose
    // account does not exist (audit 2026-08-20, H3).
    const reader = await createUserFixture({ tenantId: null, role: Role.ContentEditor });
    readerId = reader.id;
    token = tokenService.sign({ sub: readerId, tenantId: null, role: Role.Teacher });

    const [courseA] = await db
      .insert(courses)
      .values({ name: `E2E Course A ${suffix}` })
      .returning({ id: courses.id });
    courseAId = courseA!.id;

    const [courseB] = await db
      .insert(courses)
      .values({ name: `E2E Course B ${suffix}` })
      .returning({ id: courses.id });
    courseBId = courseB!.id;

    const [topicA] = await db
      .insert(topics)
      .values({ courseId: courseAId, name: `E2E Topic A ${suffix}` })
      .returning({ id: topics.id });
    topicAId = topicA!.id;

    const [topicB] = await db
      .insert(topics)
      .values({ courseId: courseBId, name: `E2E Topic B ${suffix}` })
      .returning({ id: topics.id });
    topicBId = topicB!.id;

    const [testFactoryCourse] = await db
      .insert(courses)
      .values({ name: `Test Course ${randomUUID()}` })
      .returning({ id: courses.id });
    testFactoryCourseId = testFactoryCourse!.id;
  });

  afterAll(async () => {
    const cleanupSteps: Array<[string, () => Promise<unknown>]> = [
      ["delete topics", () => db.delete(topics).where(inArray(topics.id, [topicAId, topicBId]))],
      [
        "delete courses",
        () => db.delete(courses).where(inArray(courses.id, [courseAId, courseBId, testFactoryCourseId])),
      ],
      ["delete reader user", () => deleteUserFixture(readerId)],
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

  describe("GET /courses", () => {
    it("rejects requests without a Bearer token", async () => {
      const res = await request(app.getHttpServer()).get("/courses");
      expect(res.status).toBe(401);
    });

    it("returns every course for any authenticated user", async () => {
      const res = await request(app.getHttpServer()).get("/courses").set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string; name: string }>).map((c) => c.id);
      expect(ids).toContain(courseAId);
      expect(ids).toContain(courseBId);
    });

    it("never serves a test-factory course to the exam builder", async () => {
      // Audit 2026-08-20 H1 — e2e leftovers reached a real teacher's course grid.
      const res = await request(app.getHttpServer()).get("/courses").set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((c) => c.id);
      expect(ids).not.toContain(testFactoryCourseId);
    });
  });

  describe("GET /topics", () => {
    it("rejects requests without a Bearer token", async () => {
      const res = await request(app.getHttpServer()).get("/topics");
      expect(res.status).toBe(401);
    });

    it("returns every topic when no courseId filter is given", async () => {
      const res = await request(app.getHttpServer()).get("/topics").set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((t) => t.id);
      expect(ids).toContain(topicAId);
      expect(ids).toContain(topicBId);
    });

    it("filters topics by courseId", async () => {
      const res = await request(app.getHttpServer())
        .get("/topics")
        .query({ courseId: courseAId })
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: topicAId, name: `E2E Topic A ${suffix}`, courseId: courseAId, gradeLevel: null },
      ]);
    });

    it("batch-fetches topics for a comma-separated courseId list", async () => {
      const res = await request(app.getHttpServer())
        .get("/topics")
        .query({ courseId: `${courseAId},${courseBId}` })
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((t) => t.id);
      expect(ids).toContain(topicAId);
      expect(ids).toContain(topicBId);
    });
  });

  describe("GET /universities", () => {
    let universityAId: string;
    let universityBId: string;

    beforeAll(async () => {
      const [universityA] = await db
        .insert(universities)
        .values({ code: `e2e-aaa-uni-${suffix}`, name: `E2E AAA University ${suffix}` })
        .returning({ id: universities.id });
      universityAId = universityA!.id;

      const [universityB] = await db
        .insert(universities)
        .values({ code: `e2e-zzz-uni-${suffix}`, name: `E2E ZZZ University ${suffix}` })
        .returning({ id: universities.id });
      universityBId = universityB!.id;
    });

    afterAll(async () => {
      await db.delete(universities).where(inArray(universities.id, [universityAId, universityBId]));
    });

    it("rejects requests without a Bearer token", async () => {
      const res = await request(app.getHttpServer()).get("/universities");
      expect(res.status).toBe(401);
    });

    it("returns every university ordered by name", async () => {
      const res = await request(app.getHttpServer())
        .get("/universities")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((u) => u.id);
      expect(ids).toContain(universityAId);
      expect(ids).toContain(universityBId);
      expect(ids.indexOf(universityAId)).toBeLessThan(ids.indexOf(universityBId));
    });
  });

  describe("GET /universities/:universityId/tracks", () => {
    let universityWithTracksId: string;
    let universityWithoutTracksId: string;
    let trackAId: string;
    let trackBId: string;

    beforeAll(async () => {
      const [universityWithTracks] = await db
        .insert(universities)
        .values({ code: `e2e-tracked-uni-${suffix}`, name: `E2E Tracked University ${suffix}` })
        .returning({ id: universities.id });
      universityWithTracksId = universityWithTracks!.id;

      const [universityWithoutTracks] = await db
        .insert(universities)
        .values({ code: `e2e-trackless-uni-${suffix}`, name: `E2E Trackless University ${suffix}` })
        .returning({ id: universities.id });
      universityWithoutTracksId = universityWithoutTracks!.id;

      const [trackA] = await db
        .insert(tracks)
        .values({
          universityId: universityWithTracksId,
          code: `e2e-a-track-${suffix}`,
          name: `E2E A Track ${suffix}`,
          kind: "cycle_track",
        })
        .returning({ id: tracks.id });
      trackAId = trackA!.id;

      const [trackB] = await db
        .insert(tracks)
        .values({
          universityId: universityWithTracksId,
          code: `e2e-b-track-${suffix}`,
          name: `E2E B Track ${suffix}`,
          kind: "cycle_track",
        })
        .returning({ id: tracks.id });
      trackBId = trackB!.id;
    });

    afterAll(async () => {
      await db.delete(tracks).where(inArray(tracks.id, [trackAId, trackBId]));
      await db
        .delete(universities)
        .where(inArray(universities.id, [universityWithTracksId, universityWithoutTracksId]));
    });

    it("rejects requests without a Bearer token", async () => {
      const res = await request(app.getHttpServer()).get(`/universities/${universityWithTracksId}/tracks`);
      expect(res.status).toBe(401);
    });

    it("returns the university's tracks ordered by code", async () => {
      const res = await request(app.getHttpServer())
        .get(`/universities/${universityWithTracksId}/tracks`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: trackAId, code: `e2e-a-track-${suffix}`, name: `E2E A Track ${suffix}`, kind: "cycle_track" },
        { id: trackBId, code: `e2e-b-track-${suffix}`, name: `E2E B Track ${suffix}`, kind: "cycle_track" },
      ]);
    });

    it("returns an empty array for a university with zero tracks", async () => {
      const res = await request(app.getHttpServer())
        .get(`/universities/${universityWithoutTracksId}/tracks`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("GET /exam-types", () => {
    // Base offset kept well within Postgres `integer` range (max ~2.1e9) and
    // far above the real seed data's 0-3 sortOrder values.
    const sortBase = 1_000_000 + Math.floor(Math.random() * 1_000_000);
    const codeA = `e2e-exam-type-a-${suffix}`;
    const codeB = `e2e-exam-type-b-${suffix}`;

    beforeAll(async () => {
      await db.insert(examTypes).values({
        code: codeB,
        label: `E2E Exam Type B ${suffix}`,
        courseScope: "all",
        weekScope: "none",
        sortOrder: sortBase + 1,
      });
      await db.insert(examTypes).values({
        code: codeA,
        label: `E2E Exam Type A ${suffix}`,
        courseScope: "none",
        weekScope: "none",
        sortOrder: sortBase,
      });
    });

    afterAll(async () => {
      await db.delete(examTypes).where(inArray(examTypes.code, [codeA, codeB]));
    });

    it("rejects requests without a Bearer token", async () => {
      const res = await request(app.getHttpServer()).get("/exam-types");
      expect(res.status).toBe(401);
    });

    it("returns every exam type ordered by sortOrder", async () => {
      const res = await request(app.getHttpServer())
        .get("/exam-types")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      const codes = (res.body as Array<{ code: string }>).map((e) => e.code);
      expect(codes).toContain(codeA);
      expect(codes).toContain(codeB);
      expect(codes.indexOf(codeA)).toBeLessThan(codes.indexOf(codeB));
    });
  });
});
