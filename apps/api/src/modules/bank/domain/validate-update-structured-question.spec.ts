import { validateUpdateStructuredQuestionInput } from "./validate-update-structured-question";

const CURRENT = {
  bodyTypst: "current body",
  alternatives: ["1", "2", "3"],
  correctAnswer: "0",
  figureCode: undefined as string | undefined,
};

describe("validateUpdateStructuredQuestionInput", () => {
  it("accepts an empty patch (no fields changed) merged over the current content", () => {
    const result = validateUpdateStructuredQuestionInput({}, CURRENT);
    expect(result).toEqual({ ok: true, merged: CURRENT });
  });

  it("merges a partial patch (only bodyTypst changed) over the current content", () => {
    const result = validateUpdateStructuredQuestionInput({ bodyTypst: "edited body" }, CURRENT);
    expect(result).toEqual({
      ok: true,
      merged: { ...CURRENT, bodyTypst: "edited body" },
    });
  });

  it("rejects when the merged bodyTypst is blank", () => {
    const result = validateUpdateStructuredQuestionInput({ bodyTypst: "   " }, CURRENT);
    expect(result.ok).toBe(false);
  });

  it("rejects when the merged correctAnswer is out of bounds for the merged alternatives", () => {
    const result = validateUpdateStructuredQuestionInput(
      { alternatives: ["a", "b"], correctAnswer: undefined },
      { ...CURRENT, correctAnswer: "2" },
    );
    expect(result.ok).toBe(false);
  });

  it("allows explicitly clearing figureCode by passing an empty string", () => {
    const result = validateUpdateStructuredQuestionInput(
      { figureCode: "" },
      { ...CURRENT, figureCode: "old figure" },
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.merged.figureCode).toBe("");
  });
});
