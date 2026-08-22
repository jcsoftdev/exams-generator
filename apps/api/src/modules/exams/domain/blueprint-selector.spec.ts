import { Difficulty } from "@exams-generator/shared";
import { createSeededRng } from "./ports/random.port";
import { BlueprintRow, Candidate, select, selectPreview, SelectionResult } from "./blueprint-selector";

describe("select", () => {
  it("fills a single row with `count` distinct matching candidates", () => {
    const rows: BlueprintRow[] = [{ courseId: "aritmetica", difficulty: Difficulty.Easy, count: 2 }];
    const pool: Candidate[] = [
      { id: "q1", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q2", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q3", courseId: "aritmetica", difficulty: Difficulty.Hard },
    ];

    const result = select(rows, pool, createSeededRng(1));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.questionIds).toHaveLength(2);
      expect(new Set(result.questionIds).size).toBe(2);
      for (const id of result.questionIds) {
        expect(["q1", "q2"]).toContain(id);
      }
    }
  });

  it("only selects candidates matching a row's {course, topic?, difficulty?} — mismatched difficulty is excluded even if course/topic match", () => {
    const rows: BlueprintRow[] = [
      { courseId: "algebra", topicId: "ecuaciones", difficulty: Difficulty.Medium, count: 1 },
    ];
    const pool: Candidate[] = [
      { id: "wrong-difficulty", courseId: "algebra", topicId: "ecuaciones", difficulty: Difficulty.Hard },
      { id: "wrong-topic", courseId: "algebra", topicId: "otros", difficulty: Difficulty.Medium },
      { id: "wrong-course", courseId: "rm", topicId: "ecuaciones", difficulty: Difficulty.Medium },
      { id: "correct-match", courseId: "algebra", topicId: "ecuaciones", difficulty: Difficulty.Medium },
    ];

    const result = select(rows, pool, createSeededRng(2));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.questionIds).toEqual(["correct-match"]);
    }
  });

  it("no question id is reused across rows, even when rows share matching criteria", () => {
    const rows: BlueprintRow[] = [
      { courseId: "aritmetica", difficulty: Difficulty.Easy, count: 2 },
      { courseId: "aritmetica", difficulty: Difficulty.Easy, count: 2 },
    ];
    const pool: Candidate[] = [
      { id: "q1", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q2", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q3", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q4", courseId: "aritmetica", difficulty: Difficulty.Easy },
    ];

    const result = select(rows, pool, createSeededRng(3));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.questionIds).toHaveLength(4);
      expect(new Set(result.questionIds).size).toBe(4);
      expect([...result.questionIds].sort()).toEqual(["q1", "q2", "q3", "q4"]);
    }
  });

  it("reports a shortage naming the exact failing row with requested vs available counts", () => {
    const rows: BlueprintRow[] = [{ courseId: "aritmetica", difficulty: Difficulty.Easy, count: 5 }];
    const pool: Candidate[] = [
      { id: "q1", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q2", courseId: "aritmetica", difficulty: Difficulty.Easy },
    ];

    const result = select(rows, pool, createSeededRng(4));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.shortages).toHaveLength(1);
      expect(result.shortages[0].row).toBe(rows[0]);
      expect(result.shortages[0].available).toBe(2);
    }
  });

  it("reports ALL failing rows when more than one row is short, without touching successful rows", () => {
    const rows: BlueprintRow[] = [
      { courseId: "aritmetica", difficulty: Difficulty.Easy, count: 1 },
      { courseId: "algebra", difficulty: Difficulty.Hard, count: 3 },
      { courseId: "rm", difficulty: Difficulty.Medium, count: 2 },
    ];
    const pool: Candidate[] = [
      { id: "q1", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q2", courseId: "algebra", difficulty: Difficulty.Hard },
      { id: "q3", courseId: "rm", difficulty: Difficulty.Medium },
    ];

    const result = select(rows, pool, createSeededRng(5));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.shortages).toHaveLength(2);
      expect(result.shortages.map((s) => s.row.courseId).sort()).toEqual(["algebra", "rm"]);
      expect(result.shortages.find((s) => s.row.courseId === "algebra")?.available).toBe(1);
      expect(result.shortages.find((s) => s.row.courseId === "rm")?.available).toBe(1);
    }
  });

  it("property: N randomized scenarios always satisfy no-reuse, match-only, and shortage-naming invariants", () => {
    const scenarioRng = createSeededRng(4242);
    const courses = ["aritmetica", "algebra", "rm", "rv"];
    const topics = ["t1", "t2", undefined];
    const difficulties = [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard];

    for (let scenario = 0; scenario < 200; scenario++) {
      const poolSize = 1 + Math.floor(scenarioRng() * 15);
      const pool: Candidate[] = Array.from({ length: poolSize }, (_, i) => ({
        id: `c${scenario}-${i}`,
        courseId: courses[Math.floor(scenarioRng() * courses.length)],
        topicId: topics[Math.floor(scenarioRng() * topics.length)],
        difficulty: difficulties[Math.floor(scenarioRng() * difficulties.length)],
      }));

      const rowCount = 1 + Math.floor(scenarioRng() * 3);
      const rows: BlueprintRow[] = Array.from({ length: rowCount }, () => ({
        courseId: courses[Math.floor(scenarioRng() * courses.length)],
        topicId: scenarioRng() < 0.5 ? topics[Math.floor(scenarioRng() * (topics.length - 1))] : undefined,
        difficulty:
          scenarioRng() < 0.5 ? difficulties[Math.floor(scenarioRng() * difficulties.length)] : undefined,
        count: 1 + Math.floor(scenarioRng() * 3),
      }));

      const result: SelectionResult = select(rows, pool, createSeededRng(scenario));

      const matches = (candidate: Candidate, row: BlueprintRow): boolean =>
        candidate.courseId === row.courseId &&
        (row.topicId === undefined || candidate.topicId === row.topicId) &&
        (row.difficulty === undefined || candidate.difficulty === row.difficulty);

      if (result.ok) {
        expect(result.questionIds).toHaveLength(rows.reduce((sum, row) => sum + row.count, 0));
        expect(new Set(result.questionIds).size).toBe(result.questionIds.length);
        for (const id of result.questionIds) {
          const candidate = pool.find((c) => c.id === id);
          expect(candidate).toBeDefined();
        }
      } else {
        expect(result.shortages.length).toBeGreaterThan(0);
        for (const shortage of result.shortages) {
          expect(rows).toContain(shortage.row);
          const matchingInPool = pool.filter((c) => matches(c, shortage.row)).length;
          expect(shortage.available).toBeLessThanOrEqual(matchingInPool);
          expect(shortage.available).toBeLessThan(shortage.row.count);
        }
      }
    }
  });
});

describe("selectPreview (B2 — always partial-fills, never fails wholesale)", () => {
  it("exact-fill row: pool size == count -> the whole pool is selected, deterministically", () => {
    const rows: BlueprintRow[] = [{ courseId: "aritmetica", difficulty: Difficulty.Easy, count: 2 }];
    const pool: Candidate[] = [
      { id: "q1", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q2", courseId: "aritmetica", difficulty: Difficulty.Easy },
    ];

    const [result] = selectPreview(rows, pool, createSeededRng(1));

    expect(result.requested).toBe(2);
    expect(result.available).toBe(2);
    expect([...result.questionIds].sort()).toEqual(["q1", "q2"]);
  });

  it("shortage row: pool size < count -> ALL available ids are returned (partial fill), never zero", () => {
    const rows: BlueprintRow[] = [{ courseId: "aritmetica", difficulty: Difficulty.Easy, count: 10 }];
    const pool: Candidate[] = [
      { id: "q1", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q2", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q3", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q4", courseId: "aritmetica", difficulty: Difficulty.Easy },
    ];

    const [result] = selectPreview(rows, pool, createSeededRng(2));

    expect(result.requested).toBe(10);
    expect(result.available).toBe(4);
    expect([...result.questionIds].sort()).toEqual(["q1", "q2", "q3", "q4"]);
  });

  it("over-supplied row: pool size > count -> exactly `count` ids, all a subset of the pool (never asserts exact ids — random pick)", () => {
    const rows: BlueprintRow[] = [{ courseId: "aritmetica", difficulty: Difficulty.Easy, count: 2 }];
    const pool: Candidate[] = [
      { id: "q1", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q2", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q3", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q4", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q5", courseId: "aritmetica", difficulty: Difficulty.Easy },
    ];

    const [result] = selectPreview(rows, pool, createSeededRng(3));

    expect(result.questionIds).toHaveLength(2);
    expect(result.available).toBe(5);
    for (const id of result.questionIds) {
      expect(pool.map((c) => c.id)).toContain(id);
    }
  });

  it("never fails wholesale: a shortage in row 1 does not blank out row 2's successful selection", () => {
    const rows: BlueprintRow[] = [
      { courseId: "aritmetica", difficulty: Difficulty.Easy, count: 5 },
      { courseId: "algebra", difficulty: Difficulty.Hard, count: 1 },
    ];
    const pool: Candidate[] = [
      { id: "q1", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q2", courseId: "algebra", difficulty: Difficulty.Hard },
    ];

    const results = selectPreview(rows, pool, createSeededRng(4));

    expect(results).toHaveLength(2);
    expect(results[0].questionIds).toEqual(["q1"]);
    expect(results[0].available).toBe(1);
    expect(results[1].questionIds).toEqual(["q2"]);
    expect(results[1].available).toBe(1);
  });

  it("no question id is reused across rows (same dedup semantics as select())", () => {
    const rows: BlueprintRow[] = [
      { courseId: "aritmetica", difficulty: Difficulty.Easy, count: 2 },
      { courseId: "aritmetica", difficulty: Difficulty.Easy, count: 2 },
    ];
    const pool: Candidate[] = [
      { id: "q1", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q2", courseId: "aritmetica", difficulty: Difficulty.Easy },
      { id: "q3", courseId: "aritmetica", difficulty: Difficulty.Easy },
    ];

    const results = selectPreview(rows, pool, createSeededRng(5));

    const allIds = results.flatMap((r: { questionIds: string[] }) => r.questionIds);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(results[0].questionIds).toHaveLength(2);
    expect(results[1].questionIds).toHaveLength(1); // only 1 left unused
  });
});
