import { correctAnswerLetterToIndex } from "./correct-answer-letter-to-index";

describe("correctAnswerLetterToIndex", () => {
  it.each([
    ["a", "0"],
    ["b", "1"],
    ["c", "2"],
    ["d", "3"],
    ["e", "4"],
  ])("maps letter %s to 0-based index %s", (letter, expectedIndex) => {
    expect(correctAnswerLetterToIndex(letter)).toBe(expectedIndex);
  });

  it("is case-insensitive", () => {
    expect(correctAnswerLetterToIndex("B")).toBe("1");
  });

  it("throws for an unrecognized letter", () => {
    expect(() => correctAnswerLetterToIndex("z")).toThrow();
  });
});
