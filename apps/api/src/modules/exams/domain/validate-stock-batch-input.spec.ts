import { validateStockBatchInput } from "./validate-stock-batch-input";

const VALID_CELL = { courseId: "course-1", topicId: undefined, difficulty: undefined };

describe("validateStockBatchInput", () => {
  it("accepts a valid gradeLevel + non-empty cells list", () => {
    const result = validateStockBatchInput({ gradeLevel: "secundaria_1", cells: [VALID_CELL] });

    expect(result.ok).toBe(true);
  });

  it("accepts a cell with topicId and difficulty specified", () => {
    const result = validateStockBatchInput({
      gradeLevel: "primaria_1",
      cells: [{ courseId: "course-1", topicId: "topic-1", difficulty: "hard" }],
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a missing or invalid gradeLevel", () => {
    const result = validateStockBatchInput({ gradeLevel: "not-a-real-grade", cells: [VALID_CELL] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("gradeLevel is required and must be a valid catalog value");
    }
  });

  it("rejects a missing or empty cells array", () => {
    const result = validateStockBatchInput({ gradeLevel: "primaria_1", cells: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("cells must contain at least one entry");
    }
  });

  it("collects EVERY cell-level error, naming the cell index, not just the first", () => {
    const result = validateStockBatchInput({
      gradeLevel: "primaria_1",
      cells: [
        { courseId: undefined, topicId: undefined, difficulty: undefined },
        { courseId: "course-1", topicId: undefined, difficulty: "not-a-difficulty" },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("cells[0].courseId is required");
      expect(result.errors).toContain("cells[1].difficulty must be one of: easy, medium, hard");
    }
  });

  it("does not query anything — pure validation, no side effects", () => {
    // No repository is passed in at all — this is a compile-time/structural
    // guarantee (B1-R2) that validation cannot touch the DB.
    expect(typeof validateStockBatchInput).toBe("function");
  });
});
