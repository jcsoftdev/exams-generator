import { and, eq } from "drizzle-orm";
import { GRADE_LEVELS } from "../modules/exams/domain/value-objects/grade-level";
import { db, pool } from "./client";
import { runMigrations } from "./migrate";
import { courses, gradeLevels, tenants, topics, users } from "./schema";
import { seed } from "./seed";

const DEMO_TENANT_SLUG = "colegio-demo";
const DEMO_ADMIN_EMAIL = "admin@colegio-demo.test";
/**
 * Representative (stage, course) pairs from the stage-divided syllabus seed —
 * used to assert idempotency. The same subject name recurs across stages, so a
 * course is identified by `(stage, name)`, not `name` alone.
 */
const SYLLABUS_COURSES: readonly { stage: string; name: string }[] = [
  { stage: "escuela", name: "Matemática" },
  { stage: "colegio", name: "Matemática" },
  { stage: "colegio", name: "Ciencias Sociales" },
  { stage: "preuniversitario", name: "Trigonometría" },
];

/**
 * Integration test against the real docker-compose Postgres (task 2.7):
 * running the seed script twice must not create duplicates or throw.
 * Requires the `infra` docker-compose stack (or an equivalent Postgres at
 * `DATABASE_URL`) to be reachable — see `resolveDatabaseUrl()` in `./env`.
 */
describe("seed idempotency", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("running the seed twice does not create duplicates or throw", async () => {
    await seed();
    await expect(seed()).resolves.toBeUndefined();

    const gradeLevelRows = await db.select().from(gradeLevels);
    expect(gradeLevelRows).toHaveLength(GRADE_LEVELS.length);
    expect(new Set(gradeLevelRows.map((row) => row.code)).size).toBe(GRADE_LEVELS.length);

    const tenantRows = await db.select().from(tenants).where(eq(tenants.slug, DEMO_TENANT_SLUG));
    expect(tenantRows).toHaveLength(1);

    const adminRows = await db.select().from(users).where(eq(users.email, DEMO_ADMIN_EMAIL));
    expect(adminRows).toHaveLength(1);
    expect(adminRows[0]?.tenantId).toBe(tenantRows[0]?.id);

    for (const { stage, name } of SYLLABUS_COURSES) {
      const courseRows = await db
        .select()
        .from(courses)
        .where(and(eq(courses.stage, stage), eq(courses.name, name)));
      expect(courseRows).toHaveLength(1);

      const topicRows = await db.select().from(topics).where(eq(topics.courseId, courseRows[0]!.id));
      // Idempotency: topics exist and no (name, grade) pair is duplicated on the second seed run.
      expect(topicRows.length).toBeGreaterThan(0);
      const keys = topicRows.map((row) => `${row.name}:${row.gradeLevel}`);
      expect(new Set(keys).size).toBe(topicRows.length);
    }
  });
});
