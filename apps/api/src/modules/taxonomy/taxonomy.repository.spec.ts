import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { courses, examTypes, topicGrades, topics, tracks, universities } from "../../db/schema";
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
  let testFactoryCourseId: string;
  let testFactoryTopicId: string;
  /**
   * Dash-free on purpose: the repository now hides any course/topic whose name
   * carries a UUID fragment (`TEST_TAXONOMY_NAME_PATTERN`), so a fixture that
   * has to be VISIBLE cannot be named like a test-factory row. Still unique
   * per run, and still deleted by id in `afterAll`.
   */
  const suffix = randomUUID().replace(/-/g, "");
  /** The opposite fixture — named exactly the way a test factory names one, so the guard must hide it. */
  const testFactorySuffix = randomUUID();

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
      .values({ courseId: courseAId, name: `Topic A ${suffix}` })
      .returning({ id: topics.id });
    topicAId = topicA!.id;

    const [topicB] = await db
      .insert(topics)
      .values({ courseId: courseBId, name: `Topic B ${suffix}` })
      .returning({ id: topics.id });
    topicBId = topicB!.id;

    const [testFactoryCourse] = await db
      .insert(courses)
      .values({ name: `Test Course ${testFactorySuffix}`, stage: "colegio" })
      .returning({ id: courses.id });
    testFactoryCourseId = testFactoryCourse!.id;

    const [testFactoryTopic] = await db
      .insert(topics)
      .values({
        courseId: testFactoryCourseId,
        name: `Test Topic ${testFactorySuffix}`,
      })
      .returning({ id: topics.id });
    testFactoryTopicId = testFactoryTopic!.id;

    await db.insert(topicGrades).values([
      { topicId: topicAId, gradeLevel: "secundaria_1" },
      { topicId: topicAId, gradeLevel: "secundaria_2" },
      { topicId: topicBId, gradeLevel: "pre" },
      { topicId: testFactoryTopicId, gradeLevel: "secundaria_1" },
    ]);
  });

  afterAll(async () => {
    await db.delete(topics).where(inArray(topics.id, [topicAId, topicBId, testFactoryTopicId]));
    await db.delete(courses).where(inArray(courses.id, [courseAId, courseBId, testFactoryCourseId]));
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

    it("carries each course's stage, the only thing telling two same-named courses apart", async () => {
      // Audit 2026-08-20 M2: "Comunicación" appears three times in the bank tree.
      const result = await repository.findAllCourses();

      expect(result.find((c) => c.id === courseAId)?.stage).toBe("colegio");
      expect(result.find((c) => c.id === courseBId)?.stage).toBe("preuniversitario");
    });

    it("filters courses by stage", async () => {
      const result = await repository.findAllCourses("colegio");
      const ids = result.map((c) => c.id);

      expect(ids).toContain(courseAId);
      expect(ids).not.toContain(courseBId);
    });

    it("hides test-factory courses from the product catalog", async () => {
      // Audit 2026-08-20 H1: e2e leftovers reached a real teacher's exam builder.
      const unfiltered = await repository.findAllCourses();
      expect(unfiltered.map((c) => c.id)).not.toContain(testFactoryCourseId);

      const byStage = await repository.findAllCourses("colegio");
      expect(byStage.map((c) => c.id)).not.toContain(testFactoryCourseId);
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

    it("filters topics by grade level through topic_grades, not by a column on the topic", async () => {
      const bySecundaria1 = await repository.findTopics(courseAId, "secundaria_1");
      expect(bySecundaria1.map((t) => t.id)).toEqual([topicAId]);

      // The SAME topic, matched by its second grade — one row, two grades.
      const bySecundaria2 = await repository.findTopics(courseAId, "secundaria_2");
      expect(bySecundaria2.map((t) => t.id)).toEqual([topicAId]);

      const bySecundaria5 = await repository.findTopics(courseAId, "secundaria_5");
      expect(bySecundaria5).toEqual([]);
    });

    it("projects the grades ordered by the catalog's sort_order", async () => {
      const [topic] = await repository.findTopics(courseAId);
      expect(topic!.gradeLevels).toEqual(["secundaria_1", "secundaria_2"]);
    });

    it("returns an empty grade list for a topic taught across its whole stage", async () => {
      const bare = await db
        .insert(topics)
        .values({ courseId: courseAId, name: `Topic Bare ${suffix}` })
        .returning({ id: topics.id });
      try {
        const found = (await repository.findTopics(courseAId)).find((t) => t.id === bare[0]!.id);
        expect(found!.gradeLevels).toEqual([]);
      } finally {
        await db.delete(topics).where(eq(topics.id, bare[0]!.id));
      }
    });

    it("returns a topic taught across its whole stage under ANY grade filter", async () => {
      // Zero rows in `topic_grades` means "taught at every grade of its
      // stage" (design doc 2026-09-03) — a bare `EXISTS` predicate would
      // exclude it from every grade-filtered call instead.
      const bare = await db
        .insert(topics)
        .values({ courseId: courseAId, name: `Topic Whole Stage ${suffix}` })
        .returning({ id: topics.id });
      try {
        const bySecundaria1 = await repository.findTopics(courseAId, "secundaria_1");
        expect(bySecundaria1.map((t) => t.id)).toContain(bare[0]!.id);

        // A grade the topic was never given a row for still matches — the
        // whole point of "no rows = whole stage".
        const bySecundaria5 = await repository.findTopics(courseAId, "secundaria_5");
        expect(bySecundaria5.map((t) => t.id)).toContain(bare[0]!.id);
      } finally {
        await db.delete(topics).where(eq(topics.id, bare[0]!.id));
      }
    });

    it("orders topics by name, not by the uuid the GROUP BY happens to return them in", async () => {
      // The grade `array_agg` brought a `GROUP BY` with it, and a grouped
      // query has no implicit order: with no explicit `ORDER BY` Postgres
      // hands back whatever the hash aggregate produced — effectively random
      // uuid order — and every topic picker lists the syllabus scrambled.
      const zetaName = `Topic Zeta ${suffix}`;
      const betaName = `Topic Beta ${suffix}`;
      const [zeta] = await db
        .insert(topics)
        .values({ courseId: courseAId, name: zetaName })
        .returning({ id: topics.id });
      const [beta] = await db
        .insert(topics)
        .values({ courseId: courseAId, name: betaName })
        .returning({ id: topics.id });
      try {
        const single = (await repository.findTopics(courseAId))
          .map((t) => t.name)
          .filter((name) => name === zetaName || name === betaName);
        expect(single).toEqual([betaName, zetaName]);

        const batched = (await repository.findTopicsByCourseIds([courseAId, courseBId]))
          .map((t) => t.name)
          .filter((name) => name === zetaName || name === betaName);
        expect(batched).toEqual([betaName, zetaName]);
      } finally {
        await db.delete(topics).where(inArray(topics.id, [zeta!.id, beta!.id]));
      }
    });

    it("hides topics that belong to a test-factory course", async () => {
      const unfiltered = await repository.findTopics();
      expect(unfiltered.map((t) => t.id)).not.toContain(testFactoryTopicId);

      // Even asked for by id — a stale bookmark or a cached client must not resurrect it.
      const byCourse = await repository.findTopics(testFactoryCourseId);
      expect(byCourse).toEqual([]);
    });
  });

  describe("findTopicsByCourseIds", () => {
    it("returns topics for every course id in the batch", async () => {
      const result = await repository.findTopicsByCourseIds([courseAId, courseBId]);
      const ids = result.map((t) => t.id);

      expect(ids).toContain(topicAId);
      expect(ids).toContain(topicBId);
    });

    it("combines the batch with a gradeLevel filter", async () => {
      const bySecundaria = await repository.findTopicsByCourseIds([courseAId, courseBId], "secundaria_1");
      expect(bySecundaria.map((t) => t.id)).toEqual([topicAId]);

      const byPre = await repository.findTopicsByCourseIds([courseAId, courseBId], "pre");
      expect(byPre.map((t) => t.id)).toEqual([topicBId]);
    });

    it("returns an empty array without querying the DB when courseIds is empty", async () => {
      const result = await repository.findTopicsByCourseIds([]);
      expect(result).toEqual([]);
    });

    it("drops test-factory courses from a batch without dropping the real ones", async () => {
      const result = await repository.findTopicsByCourseIds([courseAId, testFactoryCourseId]);

      expect(result.map((t) => t.id)).toEqual([topicAId]);
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
