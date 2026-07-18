import { Difficulty } from "@exams-generator/shared";
import { isGradeLevel } from "./value-objects/grade-level";

/** Pure input shape for `POST /exams/stock/batch` (B1) — same "collect every error" convention as `validate-create-exam-input.ts`. */
export interface StockBatchCellInput {
  readonly courseId: string | undefined;
  readonly topicId: string | undefined;
  readonly difficulty: string | undefined;
}

export interface StockBatchInput {
  readonly gradeLevel: string | undefined;
  readonly cells: readonly StockBatchCellInput[] | undefined;
}

export type StockBatchValidation = { readonly ok: true } | { readonly ok: false; readonly errors: readonly string[] };

const VALID_DIFFICULTIES = new Set<string>(Object.values(Difficulty));

/**
 * Validates `POST /exams/stock/batch` (B1-R2..R6): a valid `gradeLevel`
 * catalog value and a non-empty `cells` array, each cell requiring
 * `courseId` (topicId/difficulty optional). Collects EVERY violated rule,
 * naming the cell index, mirroring `validateCreateExamInput`.
 */
export function validateStockBatchInput(input: StockBatchInput): StockBatchValidation {
  const errors: string[] = [];

  if (!input.gradeLevel || !isGradeLevel(input.gradeLevel)) {
    errors.push("gradeLevel is required and must be a valid catalog value");
  }
  if (!input.cells || input.cells.length === 0) {
    errors.push("cells must contain at least one entry");
  } else {
    input.cells.forEach((cell, index) => {
      if (!cell.courseId) {
        errors.push(`cells[${index}].courseId is required`);
      }
      if (cell.difficulty !== undefined && !VALID_DIFFICULTIES.has(cell.difficulty)) {
        errors.push(`cells[${index}].difficulty must be one of: easy, medium, hard`);
      }
    });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
