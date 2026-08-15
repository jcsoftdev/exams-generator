import { Difficulty } from "@exams-generator/shared";
import { BlueprintRowRecord, QuestionPoolCandidateRecord } from "./ports/exams-repository.port";
import { createSeededRng } from "./ports/random.port";
import { matchesRowCriteria, pickReplacementQuestion } from "./pick-replacement-question";

const ROW: BlueprintRowRecord = {
  id: "row-1",
  courseId: "course-1",
  courseName: "Aritmética",
  topicId: "topic-1",
  topicName: "Teoría de Conjuntos",
  difficulty: Difficulty.Medium,
  count: 3,
};

function candidate(id: string, overrides: Partial<QuestionPoolCandidateRecord> = {}): QuestionPoolCandidateRecord {
  return {
    id,
    courseId: "course-1",
    topicId: "topic-1",
    difficulty: Difficulty.Medium,
    ...overrides,
  };
}

describe("matchesRowCriteria", () => {
  it("accepts a candidate matching course, topic and difficulty", () => {
    expect(matchesRowCriteria(candidate("q1"), ROW)).toBe(true);
  });

  it("rejects a candidate from another course", () => {
    expect(matchesRowCriteria(candidate("q1", { courseId: "course-2" }), ROW)).toBe(false);
  });

  it("rejects a candidate from another topic", () => {
    expect(matchesRowCriteria(candidate("q1", { topicId: "topic-2" }), ROW)).toBe(false);
  });

  it("rejects a candidate of another difficulty", () => {
    expect(matchesRowCriteria(candidate("q1", { difficulty: Difficulty.Hard }), ROW)).toBe(false);
  });

  it("ignores topic and difficulty when the row does not constrain them", () => {
    const looseRow: BlueprintRowRecord = { id: "row-2", courseId: "course-1", courseName: "Aritmética", count: 1 };

    expect(matchesRowCriteria(candidate("q1", { topicId: "topic-9", difficulty: Difficulty.Hard }), looseRow)).toBe(true);
  });
});

describe("pickReplacementQuestion", () => {
  it("returns a candidate matching the row criteria", () => {
    const picked = pickReplacementQuestion({
      pool: [candidate("q-other", { courseId: "course-2" }), candidate("q-good")],
      row: ROW,
      excludedIds: new Set(),
      rng: createSeededRng(1),
    });

    expect(picked).toBe("q-good");
  });

  it("never returns a question already used in this exam", () => {
    const picked = pickReplacementQuestion({
      pool: [candidate("q-used"), candidate("q-free")],
      row: ROW,
      excludedIds: new Set(["q-used"]),
      rng: createSeededRng(1),
    });

    expect(picked).toBe("q-free");
  });

  it("never returns a question already known to break compilation", () => {
    const picked = pickReplacementQuestion({
      pool: [candidate("q-broken"), candidate("q-healthy")],
      row: ROW,
      excludedIds: new Set(["q-broken"]),
      rng: createSeededRng(1),
    });

    expect(picked).toBe("q-healthy");
  });

  it("returns undefined when the row is exhausted so the caller can fail loudly", () => {
    const picked = pickReplacementQuestion({
      pool: [candidate("q-used")],
      row: ROW,
      excludedIds: new Set(["q-used"]),
      rng: createSeededRng(1),
    });

    expect(picked).toBeUndefined();
  });

  it("returns undefined when the pool holds nothing for this row at all", () => {
    const picked = pickReplacementQuestion({
      pool: [candidate("q1", { courseId: "course-9" })],
      row: ROW,
      excludedIds: new Set(),
      rng: createSeededRng(1),
    });

    expect(picked).toBeUndefined();
  });
});
