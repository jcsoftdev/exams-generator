import { createSeededRng } from "./ports/random.port";
import {
  buildVersions,
  SelectedQuestion,
  SelectedStructuredQuestion,
} from "./version-shuffler";

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

  it("structured questions: alternatives get shuffled and answerKey points to the new position of the correct one", () => {
    const structuredQuestion: SelectedStructuredQuestion = {
      type: "structured",
      questionId: "q1",
      alternatives: ["opt-zero", "opt-one", "opt-two", "opt-three"],
      correctAnswer: "2", // "opt-two" is correct, at original index 2
    };
    const selected: SelectedQuestion[] = [structuredQuestion];

    const versions = buildVersions(selected, 1, createSeededRng(99));
    const [version] = versions;

    const shuffled = version.shuffledAlternatives["q1"];
    expect(shuffled).toBeDefined();
    expect([...shuffled].sort()).toEqual(
      [...structuredQuestion.alternatives].sort(),
    ); // same content, position(s) may differ

    const letter = version.answerKey[0];
    const newIndex = letter.charCodeAt(0) - "A".charCodeAt(0);
    expect(shuffled[newIndex]).toBe("opt-two");
  });

  it("structured questions with alternativeImages: images permute IDENTICALLY to their alternatives (same index permutation), staying attached to whichever text they were originally paired with", () => {
    const structuredQuestion: SelectedStructuredQuestion = {
      type: "structured",
      questionId: "q1",
      alternatives: ["opt-zero", "opt-one", "opt-two", "opt-three"],
      correctAnswer: "2",
      alternativeImages: [
        { storageKey: "img-zero", mime: "image/png" },
        null,
        { storageKey: "img-two", mime: "image/png" },
        { storageKey: "img-three", mime: "image/jpeg" },
      ],
    };
    const selected: SelectedQuestion[] = [structuredQuestion];

    const versions = buildVersions(selected, 1, createSeededRng(99));
    const [version] = versions;

    const shuffledAlternatives = version.shuffledAlternatives["q1"]!;
    const shuffledImages = version.shuffledAlternativeImages["q1"];
    expect(shuffledImages).toBeDefined();
    expect(shuffledImages).toHaveLength(structuredQuestion.alternatives.length);

    // Rebuild the original-index -> alternative map and assert every
    // shuffled position's image still matches the SAME original index's
    // image, not a re-shuffled independent one.
    const originalIndexByAlternative = new Map(
      structuredQuestion.alternatives.map((alternative, index) => [alternative, index]),
    );
    shuffledAlternatives.forEach((alternative, newPosition) => {
      const originalIndex = originalIndexByAlternative.get(alternative)!;
      expect(shuffledImages![newPosition]).toEqual(
        structuredQuestion.alternativeImages![originalIndex],
      );
    });
  });

  it("structured questions with NO alternativeImages: shuffledAlternativeImages has no entry for that question", () => {
    const structuredQuestion: SelectedStructuredQuestion = {
      type: "structured",
      questionId: "q1",
      alternatives: ["a", "b", "c"],
      correctAnswer: "0",
    };

    const versions = buildVersions([structuredQuestion], 2, createSeededRng(3));

    for (const version of versions) {
      expect(version.shuffledAlternativeImages["q1"]).toBeUndefined();
    }
  });

  it("image questions: never shuffled — answerKey passes correctAnswer through untouched, no shuffledAlternatives entry", () => {
    const selected: SelectedQuestion[] = [
      { type: "image", questionId: "q1", correctAnswer: "C" },
      { questionId: "q2", correctAnswer: "A" }, // type omitted defaults to image
    ];

    const versions = buildVersions(selected, 2, createSeededRng(11));

    for (const version of versions) {
      expect(version.shuffledAlternatives["q1"]).toBeUndefined();
      expect(version.shuffledAlternatives["q2"]).toBeUndefined();
      version.questionOrder.forEach((questionId, position) => {
        const original = selected.find((q) => q.questionId === questionId)!;
        expect(version.answerKey[position]).toBe(original.correctAnswer);
      });
    }
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

  it("RELEASE GATE property: for any seed and any mix of image/structured questions, after shuffling questions AND structured alternatives, answer_key always identifies the alternative whose CONTENT was originally correct (only its position may change)", () => {
    const scenarioRng = createSeededRng(4242);
    const alternativePool = [
      "alt-alpha",
      "alt-beta",
      "alt-gamma",
      "alt-delta",
      "alt-epsilon",
    ];
    const imageLetters = ["A", "B", "C", "D"];

    for (let scenario = 0; scenario < 200; scenario++) {
      const questionCount = 1 + Math.floor(scenarioRng() * 8); // 1..8
      const versionCount = 1 + Math.floor(scenarioRng() * 4); // 1..4
      // scenario % 3 sweeps: all-image, all-structured, and a mix.
      const mode = scenario % 3;

      const selected: SelectedQuestion[] = Array.from(
        { length: questionCount },
        (_, i) => {
          const questionId = `q${scenario}-${i}`;
          const isStructured =
            mode === 1 || (mode === 2 && scenarioRng() < 0.5);

          if (!isStructured) {
            return {
              type: "image" as const,
              questionId,
              correctAnswer:
                imageLetters[Math.floor(scenarioRng() * imageLetters.length)],
            };
          }

          const altCount = 2 + Math.floor(scenarioRng() * 3); // 2..4
          const alternatives = Array.from(
            { length: altCount },
            (_, altIndex) => `${alternativePool[altIndex % alternativePool.length]}-${questionId}-${altIndex}`,
          );
          const correctIndex = Math.floor(scenarioRng() * altCount);

          const structured: SelectedStructuredQuestion = {
            type: "structured",
            questionId,
            alternatives,
            correctAnswer: String(correctIndex),
          };
          return structured;
        },
      );

      const originalCorrectContentByQuestionId = new Map(
        selected.map((q) => {
          if (q.type === "structured") {
            return [q.questionId, q.alternatives[Number(q.correctAnswer)]];
          }
          return [q.questionId, q.correctAnswer];
        }),
      );

      const versions = buildVersions(selected, versionCount, createSeededRng(scenario));

      expect(versions).toHaveLength(versionCount);

      for (const version of versions) {
        for (const question of selected) {
          const position = version.questionOrder.indexOf(question.questionId);
          expect(position).toBeGreaterThanOrEqual(0);

          const answerLetter = version.answerKey[position];
          const originalCorrectContent = originalCorrectContentByQuestionId.get(
            question.questionId,
          );

          if (question.type === "structured") {
            const shuffled = version.shuffledAlternatives[question.questionId];
            expect(shuffled).toBeDefined();
            // Content preserved (multiset equality), only order may change.
            expect([...shuffled].sort()).toEqual(
              [...question.alternatives].sort(),
            );

            const newIndex = answerLetter.charCodeAt(0) - "A".charCodeAt(0);
            expect(shuffled[newIndex]).toBe(originalCorrectContent);
          } else {
            expect(version.shuffledAlternatives[question.questionId]).toBeUndefined();
            expect(answerLetter).toBe(originalCorrectContent);
          }
        }
      }
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
