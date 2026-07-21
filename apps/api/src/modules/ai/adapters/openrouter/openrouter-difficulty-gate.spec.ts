import { Difficulty } from "@exams-generator/shared";
import { assertDifficultyMatchesSelfReport } from "./openrouter-difficulty-gate";
import { QuestionSelfReport } from "./openrouter-response-validator";

function selfReport(concepts: number, steps: number): QuestionSelfReport {
  return {
    conceptsUsed: Array.from({ length: concepts }, (_, i) => `concepto ${i + 1}`),
    solutionSteps: steps,
  };
}

describe("assertDifficultyMatchesSelfReport", () => {
  describe('difficulty "easy" (1 concept, at most 2 steps)', () => {
    it.each([
      ["1 concept / 1 step", selfReport(1, 1)],
      ["1 concept / 2 steps", selfReport(1, 2)],
    ])("accepts %s", (_label, report) => {
      expect(() => assertDifficultyMatchesSelfReport(report, Difficulty.Easy)).not.toThrow();
    });

    it.each([
      ["2 concepts / 1 step", selfReport(2, 1)],
      ["1 concept / 3 steps", selfReport(1, 3)],
      ["3 concepts / 4 steps", selfReport(3, 4)],
    ])("rejects %s as over-rigorous for easy", (_label, report) => {
      expect(() => assertDifficultyMatchesSelfReport(report, Difficulty.Easy)).toThrow(/easy/);
    });
  });

  describe('difficulty "medium" (2+ concepts or 3+ steps)', () => {
    it.each([
      ["2 concepts / 1 step (concepts satisfy)", selfReport(2, 1)],
      ["1 concept / 3 steps (steps satisfy)", selfReport(1, 3)],
      ["2 concepts / 2 steps", selfReport(2, 2)],
      ["3 concepts / 4 steps", selfReport(3, 4)],
    ])("accepts %s", (_label, report) => {
      expect(() => assertDifficultyMatchesSelfReport(report, Difficulty.Medium)).not.toThrow();
    });

    it.each([
      ["1 concept / 1 step", selfReport(1, 1)],
      ["1 concept / 2 steps", selfReport(1, 2)],
    ])("rejects %s as a one-step plug-in for medium", (_label, report) => {
      expect(() => assertDifficultyMatchesSelfReport(report, Difficulty.Medium)).toThrow(/medium/);
    });
  });

  describe('difficulty "hard" (3+ concepts or 4+ steps)', () => {
    it.each([
      ["3 concepts / 1 step (concepts satisfy)", selfReport(3, 1)],
      ["1 concept / 4 steps (steps satisfy)", selfReport(1, 4)],
      ["3 concepts / 4 steps", selfReport(3, 4)],
    ])("accepts %s", (_label, report) => {
      expect(() => assertDifficultyMatchesSelfReport(report, Difficulty.Hard)).not.toThrow();
    });

    it.each([
      ["1 concept / 1 step", selfReport(1, 1)],
      ["2 concepts / 2 steps", selfReport(2, 2)],
      ["2 concepts / 3 steps", selfReport(2, 3)],
    ])("rejects %s as under-rigorous for hard", (_label, report) => {
      expect(() => assertDifficultyMatchesSelfReport(report, Difficulty.Hard)).toThrow(/hard/);
    });
  });

  it("names the requested difficulty AND the reported concept/step counts in the error, so the retry prompt is actionable", () => {
    expect(() => assertDifficultyMatchesSelfReport(selfReport(1, 1), Difficulty.Hard)).toThrow(
      /hard.*1 concept.*1 step/s,
    );
  });

  it("tells the model HOW to reach the requested rigor (indirect data, hidden condition, combined concepts), not just that it failed", () => {
    expect(() => assertDifficultyMatchesSelfReport(selfReport(1, 1), Difficulty.Hard)).toThrow(
      /indirect|hidden|combin/i,
    );
  });
});
