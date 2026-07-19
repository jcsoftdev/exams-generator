import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { courses, topics } from "../../db/schema";
import { TaxonomyRepository } from "./taxonomy.repository";

/**
 * Integration test against the real docker-compose Postgres — same pattern
 * as `bank.repository.spec.ts`. Every fixture uses a random suffix so
 * repeated runs never collide, and `afterAll` deletes everything this file
 * created so the shared dev DB doesn't grow unbounded.
 */
describe("TaxonomyRepository", () => {
  const repository = new TaxonomyRepository();

  let courseAId: string;
  let courseBId: string;
  let topicAId: string;
  let topicBId: string;
  const suffix = randomUUID();

  beforeAll(async () => {
    await runMigrations();

    const [courseA] = await db
      .insert(courses)
      .values({ name: `Course A ${suffix}`, stage: "colegio" })
      .returning({ id: courses.id });
    courseAId = courseA!.id;

    const [courseB] = await db
      .insert(courses)
      .values({ name: `Course B ${suffix}`, stage: "preuniversitario" })
      .returning({ id: courses.id });
    courseBId = courseB!.id;

    const [topicA] = await db
      .insert(topics)
      .values({ courseId: courseAId, name: `Topic A ${suffix}`, gradeLevel: "secundaria_1" })
      .returning({ id: topics.id });
    topicAId = topicA!.id;

    const [topicB] = await db
      .insert(topics)
      .values({ courseId: courseBId, name: `Topic B ${suffix}`, gradeLevel: "pre" })
      .returning({ id: topics.id });
    topicBId = topicB!.id;
  });

  afterAll(async () => {
    await db.delete(topics).where(inArray(topics.id, [topicAId, topicBId]));
    await db.delete(courses).where(inArray(courses.id, [courseAId, courseBId]));
    await pool.end();
  });

  describe("findAllCourses", () => {
    it("returns every course when no stage filter is given", async () => {
      const result = await repository.findAllCourses();
      const ids = result.map((c) => c.id);

      expect(ids).toContain(courseAId);
      expect(ids).toContain(courseBId);
      expect(result.find((c) => c.id === courseAId)?.name).toBe(`Course A ${suffix}`);
    });

    it("filters courses by stage", async () => {
      const result = await repository.findAllCourses("colegio");
      const ids = result.map((c) => c.id);

      expect(ids).toContain(courseAId);
      expect(ids).not.toContain(courseBId);
    });
  });

  describe("findTopics", () => {
    it("returns every topic when no filter is given", async () => {
      const result = await repository.findTopics();
      const ids = result.map((t) => t.id);

      expect(ids).toContain(topicAId);
      expect(ids).toContain(topicBId);
    });

    it("filters topics by courseId", async () => {
      const result = await repository.findTopics(courseAId);

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(topicAId);
      expect(result[0]!.courseId).toBe(courseAId);
      expect(result[0]!.name).toBe(`Topic A ${suffix}`);
    });

    it("filters topics by grade level", async () => {
      const bySecundaria = await repository.findTopics(courseAId, "secundaria_1");
      expect(bySecundaria.map((t) => t.id)).toEqual([topicAId]);

      const byPre = await repository.findTopics(courseAId, "pre");
      expect(byPre).toHaveLength(0);
    });
  });
});
