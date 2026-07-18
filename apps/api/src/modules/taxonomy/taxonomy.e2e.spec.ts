import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Role } from "@exams-generator/shared";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { courses, topics } from "../../db/schema";
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
  const suffix = randomUUID();

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    token = tokenService.sign({ sub: randomUUID(), tenantId: null, role: Role.Teacher });

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
  });

  afterAll(async () => {
    await db.delete(topics).where(inArray(topics.id, [topicAId, topicBId]));
    await db.delete(courses).where(inArray(courses.id, [courseAId, courseBId]));
    await app.close();
    await pool.end();
  });

  describe("GET /courses", () => {
    it("rejects requests without a Bearer token", async () => {
      const res = await request(app.getHttpServer()).get("/courses");
      expect(res.status).toBe(401);
    });

    it("returns every course for any authenticated user", async () => {
      const res = await request(app.getHttpServer())
        .get("/courses")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string; name: string }>).map((c) => c.id);
      expect(ids).toContain(courseAId);
      expect(ids).toContain(courseBId);
    });
  });

  describe("GET /topics", () => {
    it("rejects requests without a Bearer token", async () => {
      const res = await request(app.getHttpServer()).get("/topics");
      expect(res.status).toBe(401);
    });

    it("returns every topic when no courseId filter is given", async () => {
      const res = await request(app.getHttpServer())
        .get("/topics")
        .set("Authorization", `Bearer ${token}`);

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
      expect(res.body).toEqual([{ id: topicAId, name: `E2E Topic A ${suffix}`, courseId: courseAId }]);
    });
  });
});
