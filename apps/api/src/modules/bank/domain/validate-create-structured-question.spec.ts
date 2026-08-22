import { Difficulty } from "@exams-generator/shared";
import { validateCreateStructuredQuestionInput } from "./validate-create-structured-question";

const VALID_INPUT = {
  courseId: "course-1",
  topicId: "topic-1",
  difficulty: Difficulty.Easy,
  gradeLevel: "primaria_1",
  bodyTypst: "$x^2 + 1 = 0$, resuelve para $x$",
  alternatives: ["1", "-1", "i", "-i", "0"],
  correctAnswer: "2",
  figureCode: undefined,
};

describe("validateCreateStructuredQuestionInput", () => {
  it("accepts a fully populated input", () => {
    expect(validateCreateStructuredQuestionInput(VALID_INPUT)).toEqual({ ok: true });
  });

  it("accepts an input with figureCode present", () => {
    expect(
      validateCreateStructuredQuestionInput({
        ...VALID_INPUT,
        figureCode: "cetz.canvas({ ... })",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects when courseId is missing", () => {
    const result = validateCreateStructuredQuestionInput({ ...VALID_INPUT, courseId: undefined });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("courseId")]),
    );
  });

  it("rejects when topicId is missing", () => {
    const result = validateCreateStructuredQuestionInput({ ...VALID_INPUT, topicId: undefined });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("topicId")]),
    );
  });

  it("rejects when difficulty is missing or not a valid Difficulty value", () => {
    expect(validateCreateStructuredQuestionInput({ ...VALID_INPUT, difficulty: undefined }).ok).toBe(false);
    expect(validateCreateStructuredQuestionInput({ ...VALID_INPUT, difficulty: "impossible" }).ok).toBe(
      false,
    );
  });

  it("rejects when gradeLevel is missing or outside the seeded catalog", () => {
    expect(validateCreateStructuredQuestionInput({ ...VALID_INPUT, gradeLevel: undefined }).ok).toBe(false);
    expect(validateCreateStructuredQuestionInput({ ...VALID_INPUT, gradeLevel: "universidad_1" }).ok).toBe(
      false,
    );
  });

  it("rejects when bodyTypst is missing or blank", () => {
    expect(validateCreateStructuredQuestionInput({ ...VALID_INPUT, bodyTypst: undefined }).ok).toBe(false);
    expect(validateCreateStructuredQuestionInput({ ...VALID_INPUT, bodyTypst: "   " }).ok).toBe(false);
  });

  it("rejects when alternatives is missing or has fewer than 2 entries", () => {
    expect(validateCreateStructuredQuestionInput({ ...VALID_INPUT, alternatives: undefined }).ok).toBe(false);
    expect(validateCreateStructuredQuestionInput({ ...VALID_INPUT, alternatives: ["only-one"] }).ok).toBe(
      false,
    );
  });

  it("rejects when any alternative is blank", () => {
    const result = validateCreateStructuredQuestionInput({
      ...VALID_INPUT,
      alternatives: ["1", "  ", "3"],
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("alternatives")]),
    );
  });

  it("rejects when correctAnswer is missing", () => {
    const result = validateCreateStructuredQuestionInput({
      ...VALID_INPUT,
      correctAnswer: undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("correctAnswer")]),
    );
  });

  it("rejects when correctAnswer is not a valid 0-based index into alternatives", () => {
    expect(validateCreateStructuredQuestionInput({ ...VALID_INPUT, correctAnswer: "not-a-number" }).ok).toBe(
      false,
    );
    expect(validateCreateStructuredQuestionInput({ ...VALID_INPUT, correctAnswer: "-1" }).ok).toBe(false);
    expect(
      // VALID_INPUT.alternatives has 5 entries (indexes 0-4)
      validateCreateStructuredQuestionInput({ ...VALID_INPUT, correctAnswer: "5" }).ok,
    ).toBe(false);
  });

  it("reports every violated rule at once, not just the first", () => {
    const result = validateCreateStructuredQuestionInput({
      courseId: undefined,
      topicId: undefined,
      difficulty: undefined,
      gradeLevel: undefined,
      bodyTypst: undefined,
      alternatives: undefined,
      correctAnswer: undefined,
      figureCode: undefined,
    });

    expect(result.ok).toBe(false);
    // courseId, topicId, difficulty, gradeLevel, bodyTypst, alternatives, correctAnswer
    expect(result.ok === false && result.errors).toHaveLength(7);
  });
});
