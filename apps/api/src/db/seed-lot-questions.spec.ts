import { buildTopicGradeInserts } from "./seed-lot-questions";

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
