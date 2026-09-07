import { LotEntry } from "./plan-lot-seed";
import { buildTopicGradeInserts, registerAlternativeImageDirs } from "./seed-lot-questions";

/**
 * Unit coverage for the pure helper only — `seedLotQuestions` itself talks to
 * the real Postgres and the object store, so it is exercised by the
 * `seed-idempotency` integration spec instead (`db/seed-idempotency.spec.ts`).
 * This is the regression test for the bug this helper fixes: a malformed or
 * missing `gradeLevel` used to reach the batched `db.insert(topicGrades)`
 * (which runs outside any try/catch), throwing a `grade_levels` FK violation
 * that aborted the rest of `seed()` instead of just failing that one question.
 */
describe("buildTopicGradeInserts", () => {
  const TOPIC_A = "11111111-1111-1111-1111-111111111111";
  const TOPIC_B = "22222222-2222-2222-2222-222222222222";

  it("turns valid discovered keys into topic_grades rows", () => {
    const discovered = new Set([`${TOPIC_A}|pre`, `${TOPIC_B}|secundaria_1`]);

    expect(buildTopicGradeInserts(discovered)).toEqual(
      expect.arrayContaining([
        { topicId: TOPIC_A, gradeLevel: "pre" },
        { topicId: TOPIC_B, gradeLevel: "secundaria_1" },
      ]),
    );
  });

  it("drops a key whose grade level is not a real GradeLevel, and keeps the valid ones", () => {
    const discovered = new Set([`${TOPIC_A}|not-a-real-grade`, `${TOPIC_B}|pre`]);

    expect(buildTopicGradeInserts(discovered)).toEqual([{ topicId: TOPIC_B, gradeLevel: "pre" }]);
  });

  it("drops a key with an empty grade level", () => {
    const discovered = new Set([`${TOPIC_A}|`]);

    expect(buildTopicGradeInserts(discovered)).toEqual([]);
  });

  it("returns an empty array for an empty set", () => {
    expect(buildTopicGradeInserts(new Set())).toEqual([]);
  });
});

/**
 * A sequence question offers five drawings and no words, so its PNGs are listed
 * in `alternativeImagePaths` rather than in `imagePath`. `uploadAsset` looks
 * every path up in the same directory map, which only the figure pass filled —
 * so those four questions failed to seed with "image not readable" while the
 * files sat on disk.
 */
describe("registerAlternativeImageDirs", () => {
  const base = {
    courseName: "Razonamiento Matemático",
    topicName: "Psicotécnico",
    gradeLevel: "pre",
    difficulty: "hard",
    correctAnswer: "0",
    sourceName: "lote, pregunta 40",
  } as unknown as LotEntry;

  it("registers every alternative drawing against its own lot directory", () => {
    const located = [
      {
        entry: { ...base, alternativeImagePaths: ["alts/q40-a.png", "alts/q40-b.png"] },
        dir: "/data/lots",
      },
    ];

    const map = registerAlternativeImageDirs(located, new Map());

    expect(map.get("alts/q40-a.png")).toBe("/data/lots");
    expect(map.get("alts/q40-b.png")).toBe("/data/lots");
  });

  it("skips the text-only slots a mixed question leaves null", () => {
    const located = [
      { entry: { ...base, alternativeImagePaths: [null, "alts/q40-b.png", null] }, dir: "/data" },
    ];

    const map = registerAlternativeImageDirs(located, new Map());

    expect([...map.keys()]).toEqual(["alts/q40-b.png"]);
  });

  it("leaves a path the figure pass already claimed on its own directory", () => {
    const located = [{ entry: { ...base, alternativeImagePaths: ["shared.png"] }, dir: "/second" }];

    const map = registerAlternativeImageDirs(located, new Map([["shared.png", "/first"]]));

    expect(map.get("shared.png")).toBe("/first");
  });

  it("does nothing for an entry with no alternative drawings", () => {
    const located = [{ entry: base, dir: "/data" }];

    expect(registerAlternativeImageDirs(located, new Map()).size).toBe(0);
  });
});
