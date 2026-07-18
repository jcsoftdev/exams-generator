import { eq } from "drizzle-orm";
import { GRADE_LEVELS } from "../modules/exams/domain/value-objects/grade-level";
import { db, pool } from "./client";
import { runMigrations } from "./migrate";
import { courses, gradeLevels, tenants, topics, users } from "./schema";
import { seed } from "./seed";

const DEMO_TENANT_SLUG = "colegio-demo";
const DEMO_ADMIN_EMAIL = "admin@colegio-demo.test";
const DEMO_COURSE_NAMES = [
  "Aritmética",
  "Álgebra",
  "Razonamiento Matemático",
  "Razonamiento Verbal",
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

    for (const courseName of DEMO_COURSE_NAMES) {
      const courseRows = await db.select().from(courses).where(eq(courses.name, courseName));
      expect(courseRows).toHaveLength(1);

      const topicRows = await db.select().from(topics).where(eq(topics.courseId, courseRows[0]!.id));
      expect(topicRows).toHaveLength(2);
    }
  });
});
