import { validateStructuredContent } from "./validate-structured-content";

const VALID_INPUT = {
  bodyTypst: "$x^2 + 1 = 0$, resuelve para $x$",
  alternatives: ["1", "-1", "i", "-i", "0"],
  correctAnswer: "2",
};

describe("validateStructuredContent", () => {
  it("returns no errors for a fully valid content payload", () => {
    expect(validateStructuredContent(VALID_INPUT)).toEqual([]);
  });

  it("rejects when bodyTypst is missing or blank", () => {
    expect(validateStructuredContent({ ...VALID_INPUT, bodyTypst: undefined })).toEqual(
      expect.arrayContaining([expect.stringContaining("bodyTypst")]),
    );
    expect(validateStructuredContent({ ...VALID_INPUT, bodyTypst: "   " })).toEqual(
      expect.arrayContaining([expect.stringContaining("bodyTypst")]),
    );
  });

  it("rejects when alternatives is missing or has fewer than 2 entries", () => {
    expect(validateStructuredContent({ ...VALID_INPUT, alternatives: undefined })).toEqual(
      expect.arrayContaining([expect.stringContaining("alternatives")]),
    );
    expect(validateStructuredContent({ ...VALID_INPUT, alternatives: ["only-one"] })).toEqual(
      expect.arrayContaining([expect.stringContaining("alternatives")]),
    );
  });

  it("rejects when any alternative is blank", () => {
    expect(validateStructuredContent({ ...VALID_INPUT, alternatives: ["1", "  ", "3"] })).toEqual(
      expect.arrayContaining([expect.stringContaining("alternatives")]),
    );
  });

  it("rejects when correctAnswer is missing or not a valid 0-based index", () => {
    expect(validateStructuredContent({ ...VALID_INPUT, correctAnswer: undefined })).toEqual(
      expect.arrayContaining([expect.stringContaining("correctAnswer")]),
    );
    expect(validateStructuredContent({ ...VALID_INPUT, correctAnswer: "not-a-number" })).toEqual(
      expect.arrayContaining([expect.stringContaining("correctAnswer")]),
    );
    expect(validateStructuredContent({ ...VALID_INPUT, correctAnswer: "-1" })).toEqual(
      expect.arrayContaining([expect.stringContaining("correctAnswer")]),
    );
    expect(validateStructuredContent({ ...VALID_INPUT, correctAnswer: "5" })).toEqual(
      expect.arrayContaining([expect.stringContaining("correctAnswer")]),
    );
  });

  it("accepts a blank alternative whose slot carries an image instead of text", () => {
    const errors = validateStructuredContent({
      bodyTypst: "¿Qué figura continúa la secuencia?",
      alternatives: ["", "", "", "", ""],
      correctAnswer: "2",
      alternativeHasImage: [true, true, true, true, true],
    });

    expect(errors).toEqual([]);
  });

  it("still rejects a blank alternative whose slot has no image either", () => {
    const errors = validateStructuredContent({
      bodyTypst: "¿Qué figura continúa la secuencia?",
      alternatives: ["", "b", "c", "d", "e"],
      correctAnswer: "2",
      alternativeHasImage: [false, false, false, false, false],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("non-blank");
  });

  it("lets text and image alternatives sit side by side", () => {
    const errors = validateStructuredContent({
      bodyTypst: "¿Cuál corresponde?",
      alternatives: ["ninguna", "", "c", "", "e"],
      correctAnswer: "1",
      alternativeHasImage: [false, true, false, true, false],
    });

    expect(errors).toEqual([]);
  });
});
