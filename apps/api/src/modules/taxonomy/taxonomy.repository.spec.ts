import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { courses, examTypes, topics, tracks, universities } from "../../db/schema";
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

  describe("findAllUniversities", () => {
    let universityAId: string;
    let universityBId: string;

    beforeAll(async () => {
      const [universityA] = await db
        .insert(universities)
        .values({ code: `aaa-uni-${suffix}`, name: `AAA University ${suffix}` })
        .returning({ id: universities.id });
      universityAId = universityA!.id;

      const [universityB] = await db
        .insert(universities)
        .values({ code: `zzz-uni-${suffix}`, name: `ZZZ University ${suffix}` })
        .returning({ id: universities.id });
      universityBId = universityB!.id;
    });

    afterAll(async () => {
      await db.delete(universities).where(inArray(universities.id, [universityAId, universityBId]));
    });

    it("returns every university ordered by name", async () => {
      const result = await repository.findAllUniversities();
      const ids = result.map((u) => u.id);

      expect(ids).toContain(universityAId);
      expect(ids).toContain(universityBId);
      expect(ids.indexOf(universityAId)).toBeLessThan(ids.indexOf(universityBId));

      const found = result.find((u) => u.id === universityAId);
      expect(found).toEqual({
        id: universityAId,
        code: `aaa-uni-${suffix}`,
        name: `AAA University ${suffix}`,
      });
    });
  });

  describe("findTracksByUniversity", () => {
    let universityWithTracksId: string;
    let universityWithoutTracksId: string;
    let trackAId: string;
    let trackBId: string;

    beforeAll(async () => {
      const [universityWithTracks] = await db
        .insert(universities)
        .values({ code: `tracked-uni-${suffix}`, name: `Tracked University ${suffix}` })
        .returning({ id: universities.id });
      universityWithTracksId = universityWithTracks!.id;

      const [universityWithoutTracks] = await db
        .insert(universities)
        .values({ code: `trackless-uni-${suffix}`, name: `Trackless University ${suffix}` })
        .returning({ id: universities.id });
      universityWithoutTracksId = universityWithoutTracks!.id;

      const [trackB] = await db
        .insert(tracks)
        .values({
          universityId: universityWithTracksId,
          code: `b-track-${suffix}`,
          name: `B Track ${suffix}`,
          kind: "cycle_track",
        })
        .returning({ id: tracks.id });
      trackBId = trackB!.id;

      const [trackA] = await db
        .insert(tracks)
        .values({
          universityId: universityWithTracksId,
          code: `a-track-${suffix}`,
          name: `A Track ${suffix}`,
          kind: "cycle_track",
        })
        .returning({ id: tracks.id });
      trackAId = trackA!.id;
    });

    afterAll(async () => {
      await db.delete(tracks).where(inArray(tracks.id, [trackAId, trackBId]));
      await db
        .delete(universities)
        .where(inArray(universities.id, [universityWithTracksId, universityWithoutTracksId]));
    });

    it("returns the university's tracks ordered by code", async () => {
      const result = await repository.findTracksByUniversity(universityWithTracksId);

      expect(result).toEqual([
        {
          id: trackAId,
          code: `a-track-${suffix}`,
          name: `A Track ${suffix}`,
          kind: "cycle_track",
        },
        {
          id: trackBId,
          code: `b-track-${suffix}`,
          name: `B Track ${suffix}`,
          kind: "cycle_track",
        },
      ]);
    });

    it("returns an empty array for a university with zero tracks", async () => {
      const result = await repository.findTracksByUniversity(universityWithoutTracksId);
      expect(result).toEqual([]);
    });
  });

  describe("findAllExamTypes", () => {
    // Base offset kept well within Postgres `integer` range (max ~2.1e9) and
    // far above the real seed data's 0-3 sortOrder values.
    const sortBase = 1_000_000 + Math.floor(Math.random() * 1_000_000);
    const codeA = `exam-type-a-${suffix}`;
    const codeB = `exam-type-b-${suffix}`;

    beforeAll(async () => {
      // Inserted in reverse sort order to prove the query orders by
      // `sort_order`, not by insertion/primary-key order.
      await db.insert(examTypes).values({
        code: codeB,
        label: `Exam Type B ${suffix}`,
        courseScope: "all",
        weekScope: "none",
        sortOrder: sortBase + 1,
      });
      await db.insert(examTypes).values({
        code: codeA,
        label: `Exam Type A ${suffix}`,
        courseScope: "none",
        weekScope: "none",
        sortOrder: sortBase,
      });
    });

    afterAll(async () => {
      await db.delete(examTypes).where(inArray(examTypes.code, [codeA, codeB]));
    });

    it("returns every exam type ordered by sortOrder", async () => {
      const result = await repository.findAllExamTypes();
      const codes = result.map((e) => e.code);

      expect(codes).toContain(codeA);
      expect(codes).toContain(codeB);
      expect(codes.indexOf(codeA)).toBeLessThan(codes.indexOf(codeB));

      const found = result.find((e) => e.code === codeA);
      expect(found).toEqual({
        code: codeA,
        label: `Exam Type A ${suffix}`,
        courseScope: "none",
        weekScope: "none",
      });
    });
  });
});
