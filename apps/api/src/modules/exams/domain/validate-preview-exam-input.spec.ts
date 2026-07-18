import { Difficulty } from "@exams-generator/shared";
import { validatePreviewExamInput } from "./validate-preview-exam-input";

const VALID_ROW = { courseId: "course-1", topicId: undefined, difficulty: undefined, count: 5 };

describe("validatePreviewExamInput", () => {
  it("accepts a valid preview with NO title field at all (B2-R4 — title is not required)", () => {
    const result = validatePreviewExamInput({ gradeLevel: "secundaria_5", blueprint: [VALID_ROW] });

    expect(result.ok).toBe(true);
  });

  it("accepts a row with topicId and difficulty specified", () => {
    const result = validatePreviewExamInput({
      gradeLevel: "primaria_1",
      blueprint: [{ courseId: "course-1", topicId: "topic-1", difficulty: Difficulty.Hard, count: 2 }],
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a missing or invalid gradeLevel", () => {
    const result = validatePreviewExamInput({ gradeLevel: "not-a-real-grade", blueprint: [VALID_ROW] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("gradeLevel is required and must be a valid catalog value");
    }
  });

  it("rejects a missing or empty blueprint", () => {
    const result = validatePreviewExamInput({ gradeLevel: "primaria_1", blueprint: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("blueprint must contain at least one row");
    }
  });

  it("collects EVERY row-level error, naming the row index, not just the first", () => {
    const result = validatePreviewExamInput({
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
});
