import { correctAnswerIndexToLetter } from "./correct-answer-index-to-letter";

describe("correctAnswerIndexToLetter", () => {
  it.each([
    ["0", "a"],
    ["1", "b"],
    ["2", "c"],
    ["3", "d"],
    ["4", "e"],
  ])("maps 0-based index %s to letter %s", (index, expectedLetter) => {
    expect(correctAnswerIndexToLetter(index)).toBe(expectedLetter);
  });

  it("throws for a non-numeric index", () => {
    expect(() => correctAnswerIndexToLetter("b")).toThrow();
  });

  it("throws for an out-of-range index", () => {
    expect(() => correctAnswerIndexToLetter("5")).toThrow();
  });

  it("throws for a negative index", () => {
    expect(() => correctAnswerIndexToLetter("-1")).toThrow();
  });
});
