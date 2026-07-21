import { validateGeneratedQuestionShape } from "./openrouter-response-validator";

const VALID: Record<string, unknown> = {
  bodyTypst: "¿Cuánto es $1+1$?",
  alternatives: ["1", "2", "3", "4", "5"],
  correctAnswer: "b",
  figureCode: null,
  conceptsUsed: ["suma de enteros"],
  solutionSteps: 1,
};

describe("validateGeneratedQuestionShape", () => {
  it("accepts a valid payload and normalizes null figureCode to undefined", () => {
    const result = validateGeneratedQuestionShape(VALID);

    expect(result).toEqual({
      question: {
        bodyTypst: "¿Cuánto es $1+1$?",
        alternatives: ["1", "2", "3", "4", "5"],
        correctAnswer: "b",
        figureCode: undefined,
      },
      selfReport: {
        conceptsUsed: ["suma de enteros"],
        solutionSteps: 1,
      },
    });
  });

  it("accepts a valid payload with a non-null figureCode", () => {
    const result = validateGeneratedQuestionShape({
      ...VALID,
      figureCode: "#circle((0,0))",
    });

    expect(result.question.figureCode).toBe("#circle((0,0))");
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
    ["missing conceptsUsed", { ...VALID, conceptsUsed: undefined }],
    ["conceptsUsed as an empty array", { ...VALID, conceptsUsed: [] }],
    ["conceptsUsed with a non-string entry", { ...VALID, conceptsUsed: ["suma", 3] }],
    ["conceptsUsed with an empty entry", { ...VALID, conceptsUsed: ["suma", ""] }],
    ["missing solutionSteps", { ...VALID, solutionSteps: undefined }],
    ["solutionSteps as zero", { ...VALID, solutionSteps: 0 }],
    ["solutionSteps as a non-integer", { ...VALID, solutionSteps: 1.5 }],
    ["solutionSteps as a string", { ...VALID, solutionSteps: "2" }],
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

    expect(result.question.bodyTypst).toBe("Primera línea \\ Segunda línea, con $1+1$ en medio.");
  });

  it("accepts a backslash-non-letter escape used inside math mode ($...$)", () => {
    // The test above puts its backslash OUTSIDE the only $...$ segment, so
    // it never actually exercises the MATH_SEGMENT scanner — it only
    // proves "backslash outside math is fine". This fixture puts a Typst
    // line-break escape (backslash followed by a space, a non-letter)
    // INSIDE the math segment, proving LATEX_COMMAND (/\\[a-zA-Z]+/)
    // correctly does not false-positive on it once it's actually scanned.
    const result = validateGeneratedQuestionShape({
      ...VALID,
      bodyTypst: "Resuelve: $x + 1 = 2 \\ y - 1 = 0$",
    });

    expect(result.question.bodyTypst).toBe("Resuelve: $x + 1 = 2 \\ y - 1 = 0$");
  });

  it("accepts LaTeX wrapped in #mi(), even though it contains backslash commands", () => {
    const result = validateGeneratedQuestionShape({
      ...VALID,
      bodyTypst:
        'El área es #mi("\\frac{1}{2} \\cdot b \\cdot h") — con $b$ y $h$ en cm.',
    });

    expect(result.question.bodyTypst).toContain('#mi("\\frac{1}{2}');
  });

  it("is not fooled by a literal $ inside #mi(), in either direction", () => {
    // A $ inside #mi() must not pair with a later real $...$ segment —
    // the genuine \frac inside $...$ must still be caught.
    expect(() =>
      validateGeneratedQuestionShape({
        ...VALID,
        bodyTypst: '#mi("a$b") texto $\\frac{1}{2}$ fin.',
      }),
    ).toThrow(/\\frac/);

    // A $ inside #mi() must not falsely pair with an unrelated earlier $
    // (e.g. currency) and pull the mitex content into a flagged "segment".
    const result = validateGeneratedQuestionShape({
      ...VALID,
      bodyTypst: 'Precio $5. Área #mi("\\frac{a}{b}") aquí $x$ final.',
    });
    expect(result.question.bodyTypst).toContain('#mi("\\frac{a}{b}")');
  });
});
