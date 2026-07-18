import { Difficulty } from "@exams-generator/shared";
import { validateCreateImageQuestionInput } from "./validate-create-image-question";

const VALID_INPUT = {
  courseId: "course-1",
  topicId: "topic-1",
  difficulty: Difficulty.Easy,
  gradeLevel: "primaria_1",
  correctAnswer: "b",
  hasImage: true,
};

describe("validateCreateImageQuestionInput", () => {
  it("accepts a fully populated input", () => {
    expect(validateCreateImageQuestionInput(VALID_INPUT)).toEqual({ ok: true });
  });

  it("rejects when courseId is missing", () => {
    const result = validateCreateImageQuestionInput({ ...VALID_INPUT, courseId: undefined });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("courseId")]),
    );
  });

  it("rejects when topicId is missing", () => {
    const result = validateCreateImageQuestionInput({ ...VALID_INPUT, topicId: undefined });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("topicId")]),
    );
  });

  it("rejects when difficulty is missing or not a valid Difficulty value", () => {
    expect(
      validateCreateImageQuestionInput({ ...VALID_INPUT, difficulty: undefined }).ok,
    ).toBe(false);
    expect(
      validateCreateImageQuestionInput({ ...VALID_INPUT, difficulty: "impossible" }).ok,
    ).toBe(false);
  });

  it("rejects when gradeLevel is missing or outside the seeded catalog", () => {
    expect(
      validateCreateImageQuestionInput({ ...VALID_INPUT, gradeLevel: undefined }).ok,
    ).toBe(false);
    expect(
      validateCreateImageQuestionInput({ ...VALID_INPUT, gradeLevel: "universidad_1" }).ok,
    ).toBe(false);
  });

  it("rejects when correctAnswer is missing or blank", () => {
    expect(
      validateCreateImageQuestionInput({ ...VALID_INPUT, correctAnswer: undefined }).ok,
    ).toBe(false);
    expect(
      validateCreateImageQuestionInput({ ...VALID_INPUT, correctAnswer: "   " }).ok,
    ).toBe(false);
  });

  it("rejects when no image file was attached", () => {
    const result = validateCreateImageQuestionInput({ ...VALID_INPUT, hasImage: false });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("image")]),
    );
  });

  it("reports every violated rule at once, not just the first", () => {
    const result = validateCreateImageQuestionInput({
      courseId: undefined,
      topicId: undefined,
      difficulty: undefined,
      gradeLevel: undefined,
      correctAnswer: undefined,
      hasImage: false,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toHaveLength(6);
  });
});
