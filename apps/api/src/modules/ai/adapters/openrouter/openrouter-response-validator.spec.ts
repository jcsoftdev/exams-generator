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
    expect(() => validateGeneratedQuestionShape({ ...VALID, bodyTypst: "Si $\\circ = 1$" })).toThrow(
      /\\circ/,
    );
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
      bodyTypst: 'El área es #mi("\\frac{1}{2} \\cdot b \\cdot h") — con $b$ y $h$ en cm.',
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

  describe("suggestedCourse/suggestedTopic (extract-only, best-effort)", () => {
    it("carries them through as suggestedCourseName/suggestedTopicName when present", () => {
      const result = validateGeneratedQuestionShape({
        ...VALID,
        suggestedCourse: "Comunicación",
        suggestedTopic: "Sinónimos y antónimos",
      });

      expect(result.question.suggestedCourseName).toBe("Comunicación");
      expect(result.question.suggestedTopicName).toBe("Sinónimos y antónimos");
    });

    it.each([
      ["both null", { suggestedCourse: null, suggestedTopic: null }],
      ["both absent", {}],
      ["both blank strings", { suggestedCourse: "  ", suggestedTopic: "" }],
    ])("normalizes to undefined, never throws, when %s", (_label, overrides) => {
      const result = validateGeneratedQuestionShape({ ...VALID, ...overrides });

      expect(result.question.suggestedCourseName).toBeUndefined();
      expect(result.question.suggestedTopicName).toBeUndefined();
    });

    it("does not reject the payload when they are the wrong type — never a hard validation error", () => {
      const result = validateGeneratedQuestionShape({
        ...VALID,
        suggestedCourse: 42,
        suggestedTopic: ["not", "a", "string"],
      });

      expect(result.question.suggestedCourseName).toBeUndefined();
      expect(result.question.suggestedTopicName).toBeUndefined();
    });
  });
});

describe("validateGeneratedQuestionShape — answer leaked into the statement", () => {
  function withBody(bodyTypst: string): Record<string, unknown> {
    return {
      bodyTypst,
      alternatives: ["1", "2", "3", "4", "5"],
      correctAnswer: "e",
      conceptsUsed: ["conjuntos"],
      solutionSteps: 2,
    };
  }

  /** Verbatim from a real extraction: every proposition annotated with its verdict. */
  const LEAKED = [
    "Si: $A = {13; 5}$ indicar cuantas proposiciones son verdaderas.",
    "",
    "$(3; {5}] subset A -> F$",
    "",
    "$(3; 5] subset.not A -> V$",
    "",
    "$emptyset in P(A) -> V$",
  ].join("\n");

  it("MUST: rejects a body whose propositions carry -> V / -> F verdicts", () => {
    // Shipping this prints the answer key inside the exam question.
    expect(() => validateGeneratedQuestionShape(withBody(LEAKED))).toThrow(/TRANSCRIBE/i);
  });

  it("names the count in the error, so the retry knows how much to remove", () => {
    expect(() => validateGeneratedQuestionShape(withBody(LEAKED))).toThrow(/3 lines/);
  });

  it("also catches ticks and crosses, and a trailing (V)", () => {
    const ticks = "Proposición uno ✓\n\nProposición dos ✗";
    const parens = "Proposición uno (V)\n\nProposición dos (F)";

    expect(() => validateGeneratedQuestionShape(withBody(ticks))).toThrow(/TRANSCRIBE/i);
    expect(() => validateGeneratedQuestionShape(withBody(parens))).toThrow(/TRANSCRIBE/i);
  });

  it("leaves a legitimate arrow alone — a limit is not a verdict", () => {
    const legit = "Si $x -> 3$ entonces el límite es $9$.\n\nHalla el valor de $y$.";

    expect(() => validateGeneratedQuestionShape(withBody(legit))).not.toThrow();
  });

  it("tolerates ONE annotation — a column of them is the model solving, a single one may be the question's own wording", () => {
    const single = "La proposición $p -> V$ se lee así.\n\n¿Cuál es el valor?";

    expect(() => validateGeneratedQuestionShape(withBody(single))).not.toThrow();
  });
});

describe("validateGeneratedQuestionShape — correctAnswer casing", () => {
  function basePayload(): Record<string, unknown> {
    return {
      bodyTypst: "¿Cuánto es $2 + 2$?",
      alternatives: ["3", "4", "5", "6", "7"],
      correctAnswer: "b",
      conceptsUsed: ["suma"],
      solutionSteps: 1,
    };
  }

  it('accepts an uppercase letter and normalizes it — models emit "E" constantly', () => {
    const { question } = validateGeneratedQuestionShape({ ...basePayload(), correctAnswer: "E" });

    expect(question.correctAnswer).toBe("e");
  });

  it("tolerates surrounding whitespace", () => {
    const { question } = validateGeneratedQuestionShape({ ...basePayload(), correctAnswer: " c " });

    expect(question.correctAnswer).toBe("c");
  });

  it("still rejects a letter outside a..e", () => {
    expect(() => validateGeneratedQuestionShape({ ...basePayload(), correctAnswer: "Z" })).toThrow(
      /correctAnswer/,
    );
  });
});

describe("validateGeneratedQuestionShape — crop boxes", () => {
  /** A payload that already satisfies every pre-existing rule. */
  function basePayload(): Record<string, unknown> {
    return {
      bodyTypst: "¿Cuánto es $2 + 2$?",
      alternatives: ["3", "4", "5", "6", "7"],
      correctAnswer: "b",
      conceptsUsed: ["suma"],
      solutionSteps: 1,
    };
  }

  it("keeps a valid figureBox", () => {
    const { question } = validateGeneratedQuestionShape({
      ...basePayload(),
      figureBox: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 },
    });

    expect(question.figureBox).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.3 });
  });

  it("drops an out-of-canvas figureBox without failing the extraction", () => {
    const { question } = validateGeneratedQuestionShape({
      ...basePayload(),
      figureBox: { x: 0.8, y: 0.2, w: 0.5, h: 0.3 },
    });

    expect(question.figureBox).toBeUndefined();
    expect(question.bodyTypst).toBe("¿Cuánto es $2 + 2$?");
  });

  it("normalizes a null figureBox to undefined", () => {
    const { question } = validateGeneratedQuestionShape({ ...basePayload(), figureBox: null });

    expect(question.figureBox).toBeUndefined();
  });

  it("keeps alternativeBoxes with nulls for the text-only alternatives", () => {
    const box = { x: 0.1, y: 0.6, w: 0.15, h: 0.1 };
    const { question } = validateGeneratedQuestionShape({
      ...basePayload(),
      alternativeBoxes: [box, null, box, null, null],
    });

    expect(question.alternativeBoxes).toEqual([box, null, box, null, null]);
  });

  it("nulls out only the invalid entries of alternativeBoxes", () => {
    const good = { x: 0.1, y: 0.6, w: 0.15, h: 0.1 };
    const { question } = validateGeneratedQuestionShape({
      ...basePayload(),
      alternativeBoxes: [good, { x: 0.5, y: 0.5, w: 0.9, h: 0.1 }, null, null, null],
    });

    expect(question.alternativeBoxes).toEqual([good, null, null, null, null]);
  });

  it("drops alternativeBoxes entirely when its length does not match the alternatives", () => {
    const box = { x: 0.1, y: 0.6, w: 0.15, h: 0.1 };
    const { question } = validateGeneratedQuestionShape({
      ...basePayload(),
      alternativeBoxes: [box, null],
    });

    expect(question.alternativeBoxes).toBeUndefined();
  });

  it("drops alternativeBoxes when every entry is null — nothing to crop", () => {
    const { question } = validateGeneratedQuestionShape({
      ...basePayload(),
      alternativeBoxes: [null, null, null, null, null],
    });

    expect(question.alternativeBoxes).toBeUndefined();
  });
});
