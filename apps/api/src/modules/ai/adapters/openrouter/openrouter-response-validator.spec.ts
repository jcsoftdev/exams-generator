import { validateGeneratedQuestionShape } from "./openrouter-response-validator";

const VALID: Record<string, unknown> = {
  bodyTypst: "¿Cuánto es $1+1$?",
  alternatives: ["1", "2", "3", "4", "5"],
  correctAnswer: "b",
  figureCode: null,
};

describe("validateGeneratedQuestionShape", () => {
  it("accepts a valid payload and normalizes null figureCode to undefined", () => {
    const result = validateGeneratedQuestionShape(VALID);

    expect(result).toEqual({
      bodyTypst: "¿Cuánto es $1+1$?",
      alternatives: ["1", "2", "3", "4", "5"],
      correctAnswer: "b",
      figureCode: undefined,
    });
  });

  it("accepts a valid payload with a non-null figureCode", () => {
    const result = validateGeneratedQuestionShape({
      ...VALID,
      figureCode: "#circle((0,0))",
    });

    expect(result.figureCode).toBe("#circle((0,0))");
  });

  it.each([
    ["not an object", "just a string"],
    ["null", null],
    ["missing bodyTypst", { ...VALID, bodyTypst: undefined }],
    ["empty bodyTypst", { ...VALID, bodyTypst: "" }],
    ["alternatives with 4 entries", { ...VALID, alternatives: ["1", "2", "3", "4"] }],
    ["alternatives with 6 entries", { ...VALID, alternatives: ["1", "2", "3", "4", "5", "6"] }],
    ["alternatives with a non-string entry", { ...VALID, alternatives: ["1", "2", 3, "4", "5"] }],
    ["alternatives with an empty entry", { ...VALID, alternatives: ["", "2", "3", "4", "5"] }],
    ["correctAnswer outside a-e", { ...VALID, correctAnswer: "f" }],
    ["correctAnswer as a number", { ...VALID, correctAnswer: 1 }],
    ["figureCode as a number", { ...VALID, figureCode: 42 }],
    ["LaTeX \\frac inside math mode", { ...VALID, bodyTypst: "Halla $\\frac{1}{2}$" }],
    ["LaTeX \\circ inside math mode", { ...VALID, bodyTypst: 'Si $\\angle "BAD" = 70^{\\circ}$' }],
    ["LaTeX \\times inside math mode", { ...VALID, bodyTypst: "Calcula $3 \\times 10^8$" }],
  ])("rejects: %s", (_label, payload) => {
    expect(() => validateGeneratedQuestionShape(payload)).toThrow(TypeError);
  });

  it("rejects with a message naming the offending LaTeX command, for the retry prompt", () => {
    expect(() =>
      validateGeneratedQuestionShape({ ...VALID, bodyTypst: "Si $\\circ = 1$" }),
    ).toThrow(/\\circ/);
  });

  it("accepts a lone backslash outside math mode (Typst line-break syntax)", () => {
    const result = validateGeneratedQuestionShape({
      ...VALID,
      bodyTypst: "Primera línea \\ Segunda línea, con $1+1$ en medio.",
    });

    expect(result.bodyTypst).toBe("Primera línea \\ Segunda línea, con $1+1$ en medio.");
  });

  it("accepts LaTeX wrapped in #mi(), even though it contains backslash commands", () => {
    const result = validateGeneratedQuestionShape({
      ...VALID,
      bodyTypst:
        'El área es #mi("\\frac{1}{2} \\cdot b \\cdot h") — con $b$ y $h$ en cm.',
    });

    expect(result.bodyTypst).toContain('#mi("\\frac{1}{2}');
  });
});
