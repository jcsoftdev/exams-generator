import { Difficulty } from "@exams-generator/shared";
import { validateGenerateQuestionsInput } from "./validate-generate-questions-input";

const VALID_INPUT = {
  courseId: "course-1",
  topicId: "topic-1",
  difficulty: Difficulty.Easy,
  gradeLevel: "primaria_1",
  count: 3,
  withFigure: false,
};

describe("validateGenerateQuestionsInput", () => {
  it("accepts a fully populated input", () => {
    expect(validateGenerateQuestionsInput(VALID_INPUT)).toEqual({ ok: true });
  });

  it("accepts an input without withFigure (defaults handled by the caller, not here)", () => {
    const { withFigure: _withFigure, ...rest } = VALID_INPUT;
    expect(validateGenerateQuestionsInput(rest)).toEqual({ ok: true });
  });

  it("rejects when courseId is missing", () => {
    const result = validateGenerateQuestionsInput({ ...VALID_INPUT, courseId: undefined });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("courseId")]),
    );
  });

  it("rejects when topicId is missing", () => {
    const result = validateGenerateQuestionsInput({ ...VALID_INPUT, topicId: undefined });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("topicId")]),
    );
  });

  it("rejects when difficulty is missing or invalid", () => {
    expect(validateGenerateQuestionsInput({ ...VALID_INPUT, difficulty: undefined }).ok).toBe(
      false,
    );
    expect(
      validateGenerateQuestionsInput({ ...VALID_INPUT, difficulty: "impossible" }).ok,
    ).toBe(false);
  });

  it("rejects when gradeLevel is missing or outside the seeded catalog", () => {
    expect(validateGenerateQuestionsInput({ ...VALID_INPUT, gradeLevel: undefined }).ok).toBe(
      false,
    );
    expect(
      validateGenerateQuestionsInput({ ...VALID_INPUT, gradeLevel: "universidad_1" }).ok,
    ).toBe(false);
  });

  it("rejects when count is missing, not an integer, or out of the [1, 10] range", () => {
    expect(validateGenerateQuestionsInput({ ...VALID_INPUT, count: undefined }).ok).toBe(false);
    expect(validateGenerateQuestionsInput({ ...VALID_INPUT, count: 0 }).ok).toBe(false);
    expect(validateGenerateQuestionsInput({ ...VALID_INPUT, count: 1.5 }).ok).toBe(false);
    expect(validateGenerateQuestionsInput({ ...VALID_INPUT, count: 11 }).ok).toBe(false);
  });

  it("rejects when withFigure is provided but not a boolean", () => {
    const result = validateGenerateQuestionsInput({
      ...VALID_INPUT,
      withFigure: "yes" as unknown as boolean,
    });
    expect(result.ok).toBe(false);
  });

  it("reports every violated rule at once, not just the first", () => {
    const result = validateGenerateQuestionsInput({
      courseId: undefined,
      topicId: undefined,
      difficulty: undefined,
      gradeLevel: undefined,
      count: undefined,
      withFigure: undefined,
    });

    expect(result.ok).toBe(false);
    // courseId, topicId, difficulty, gradeLevel, count
    expect(result.ok === false && result.errors).toHaveLength(5);
  });
});
