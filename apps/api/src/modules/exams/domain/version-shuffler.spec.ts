import { createSeededRng } from "./ports/random.port";
import { buildVersions, SelectedQuestion } from "./version-shuffler";

describe("buildVersions", () => {
  it("builds a version per requested count, coded A, B, C... sequentially", () => {
    const selected: SelectedQuestion[] = [
      { questionId: "q1", correctAnswer: "A" },
      { questionId: "q2", correctAnswer: "B" },
      { questionId: "q3", correctAnswer: "C" },
    ];

    const versions = buildVersions(selected, 3, createSeededRng(1));

    expect(versions).toHaveLength(3);
    expect(versions.map((v) => v.code)).toEqual(["A", "B", "C"]);
  });

  it("MUST: answerKey at every position always resolves to the correct answer of the question now at that position", () => {
    const selected: SelectedQuestion[] = [
      { questionId: "q1", correctAnswer: "A" },
      { questionId: "q2", correctAnswer: "C" },
      { questionId: "q3", correctAnswer: "B" },
      { questionId: "q4", correctAnswer: "D" },
    ];

    const versions = buildVersions(selected, 2, createSeededRng(42));

    const correctAnswerByQuestionId = new Map(
      selected.map((q) => [q.questionId, q.correctAnswer]),
    );

    for (const version of versions) {
      version.questionOrder.forEach((questionId, position) => {
        expect(version.answerKey[position]).toBe(
          correctAnswerByQuestionId.get(questionId),
        );
      });
    }
  });

  it("questionOrder is a permutation (bijection) of the input question ids — no dups, no omissions", () => {
    const selected: SelectedQuestion[] = [
      { questionId: "q1", correctAnswer: "A" },
      { questionId: "q2", correctAnswer: "B" },
      { questionId: "q3", correctAnswer: "C" },
      { questionId: "q4", correctAnswer: "D" },
      { questionId: "q5", correctAnswer: "A" },
    ];
    const inputIds = selected.map((q) => q.questionId).sort();

    const versions = buildVersions(selected, 4, createSeededRng(7));

    for (const version of versions) {
      expect(version.questionOrder).toHaveLength(selected.length);
      expect([...version.questionOrder].sort()).toEqual(inputIds);
      expect(new Set(version.questionOrder).size).toBe(selected.length);
    }
  });

  it("distinct versions produce distinct question orders when versionCount>1 and n>1 with enough permutation capacity", () => {
    const selected: SelectedQuestion[] = [
      { questionId: "q1", correctAnswer: "A" },
      { questionId: "q2", correctAnswer: "B" },
      { questionId: "q3", correctAnswer: "C" },
      { questionId: "q4", correctAnswer: "D" },
      { questionId: "q5", correctAnswer: "E" },
    ];

    const versions = buildVersions(selected, 3, createSeededRng(123));

    const orders = versions.map((v) => v.questionOrder.join("|"));
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("boundary: n=1 makes exact-distinctness across versions impossible — must not throw and still returns versionCount versions", () => {
    const selected: SelectedQuestion[] = [{ questionId: "only", correctAnswer: "A" }];

    const versions = buildVersions(selected, 3, createSeededRng(5));

    expect(versions).toHaveLength(3);
    expect(versions.map((v) => v.code)).toEqual(["A", "B", "C"]);
    for (const version of versions) {
      expect(version.questionOrder).toEqual(["only"]);
      expect(version.answerKey[0]).toBe("A");
    }
  });

  it("boundary: n=2 with versionCount=5 exceeds permutation capacity (only 2! orders possible) — degrades gracefully without hanging", () => {
    const selected: SelectedQuestion[] = [
      { questionId: "q1", correctAnswer: "A" },
      { questionId: "q2", correctAnswer: "B" },
    ];

    const versions = buildVersions(selected, 5, createSeededRng(9));

    expect(versions).toHaveLength(5);
    for (const version of versions) {
      expect([...version.questionOrder].sort()).toEqual(["q1", "q2"]);
    }
  });

  it("returns an empty list when there are no selected questions", () => {
    expect(buildVersions([], 3, createSeededRng(1))).toEqual([]);
  });

  it("property: N randomized scenarios all satisfy the answer_key + permutation invariants", () => {
    const scenarioRng = createSeededRng(2026);
    const letters = ["A", "B", "C", "D", "E"];

    for (let scenario = 0; scenario < 200; scenario++) {
      const questionCount = 1 + Math.floor(scenarioRng() * 8); // 1..8
      const versionCount = 1 + Math.floor(scenarioRng() * 5); // 1..5
      const selected: SelectedQuestion[] = Array.from(
        { length: questionCount },
        (_, i) => ({
          questionId: `q${scenario}-${i}`,
          correctAnswer: letters[Math.floor(scenarioRng() * letters.length)],
        }),
      );
      const correctAnswerByQuestionId = new Map(
        selected.map((q) => [q.questionId, q.correctAnswer]),
      );
      const inputIds = selected.map((q) => q.questionId).sort();

      const versions = buildVersions(selected, versionCount, createSeededRng(scenario));

      expect(versions).toHaveLength(versionCount);
      versions.forEach((version, index) => {
        expect(version.code).toBe(expectedCode(index));
        expect(version.questionOrder).toHaveLength(questionCount);
        expect([...version.questionOrder].sort()).toEqual(inputIds);
        expect(new Set(version.questionOrder).size).toBe(questionCount);

        version.questionOrder.forEach((questionId, position) => {
          expect(version.answerKey[position]).toBe(
            correctAnswerByQuestionId.get(questionId),
          );
        });
      });
    }
  });
});

function expectedCode(index: number): string {
  let n = index + 1;
  let code = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    code = String.fromCharCode(65 + rem) + code;
    n = Math.floor((n - 1) / 26);
  }
  return code;
}
