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
});
