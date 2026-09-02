import {
  correctAnswerLetterToIndex,
  correctAnswerLetterToIndexOrNull,
} from "./correct-answer-letter-to-index";

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

  it("throws on an unexpected null instead of silently returning null — the strict (non-nullable) signature never lies about its output", () => {
    // A caller can defeat the `string` parameter type at runtime (an unsafe
    // cast, a JS caller, a boundary that loses the type) — when that happens
    // this must fail loudly, not hand back a `null` a `string`-typed caller
    // never checks for. `null`-in/`null`-out only exists on
    // `correctAnswerLetterToIndexOrNull`, below.
    expect(() => correctAnswerLetterToIndex(null as unknown as string)).toThrow();
  });
});

describe("correctAnswerLetterToIndexOrNull", () => {
  it("passes null straight through, unconverted", () => {
    expect(correctAnswerLetterToIndexOrNull(null)).toBeNull();
  });

  it("delegates to correctAnswerLetterToIndex for a real letter", () => {
    expect(correctAnswerLetterToIndexOrNull("c")).toBe("2");
  });

  it("still throws for an unrecognized letter", () => {
    expect(() => correctAnswerLetterToIndexOrNull("z")).toThrow();
  });
});
