import { Difficulty } from "@exams-generator/shared";
import { validateCreateExamInput } from "./validate-create-exam-input";

const VALID_ROW = { courseId: "course-1", topicId: undefined, difficulty: undefined, count: 5 };

describe("validateCreateExamInput", () => {
  it("accepts a valid exam with a single blueprint row targeting an entire course", () => {
    const result = validateCreateExamInput({
      title: "Simulacro San Marcos",
      gradeLevel: "secundaria_5",
      blueprint: [VALID_ROW],
    });

    expect(result.ok).toBe(true);
  });

  it("accepts a row with topicId and difficulty specified", () => {
    const result = validateCreateExamInput({
      title: "Simulacro",
      gradeLevel: "primaria_1",
      blueprint: [{ courseId: "course-1", topicId: "topic-1", difficulty: Difficulty.Hard, count: 2 }],
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a missing title", () => {
    const result = validateCreateExamInput({
      title: undefined,
      gradeLevel: "primaria_1",
      blueprint: [VALID_ROW],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("title is required");
    }
  });

  it("rejects a missing or invalid gradeLevel", () => {
    const result = validateCreateExamInput({
      title: "Simulacro",
      gradeLevel: "not-a-real-grade",
      blueprint: [VALID_ROW],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("gradeLevel is required and must be a valid catalog value");
    }
  });

  it("rejects a missing or empty blueprint", () => {
    const result = validateCreateExamInput({
      title: "Simulacro",
      gradeLevel: "primaria_1",
      blueprint: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("blueprint must contain at least one row");
    }
  });

  it("collects EVERY row-level error, naming the row index, not just the first", () => {
    const result = validateCreateExamInput({
      title: "Simulacro",
      gradeLevel: "primaria_1",
      blueprint: [
        { courseId: undefined, topicId: undefined, difficulty: undefined, count: 3 },
        { courseId: "course-1", topicId: undefined, difficulty: "not-a-difficulty", count: 0 },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("blueprint[0].courseId is required");
      expect(result.errors).toContain("blueprint[1].difficulty must be one of: easy, medium, hard");
      expect(result.errors).toContain("blueprint[1].count must be a positive integer");
    }
  });

  it("rejects a non-integer or non-positive count", () => {
    const result = validateCreateExamInput({
      title: "Simulacro",
      gradeLevel: "primaria_1",
      blueprint: [{ courseId: "course-1", topicId: undefined, difficulty: undefined, count: -1 }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("blueprint[0].count must be a positive integer");
    }
  });
});
