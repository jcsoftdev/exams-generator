import { Difficulty } from "@exams-generator/shared";
import { isGradeLevel } from "./value-objects/grade-level";

/**
 * Pure input shape the controller/service maps its raw request into before
 * validating — mirrors `validate-create-image-question.ts` in the bank
 * module (same "collect every error, pure function" convention).
 */
export interface CreateExamBlueprintRowInput {
  readonly courseId: string | undefined;
  readonly topicId: string | undefined;
  readonly difficulty: string | undefined;
  readonly count: number | undefined;
}

/**
 * `examType`/`universityId`/`trackId`/`cycleId`/`weekNumber` are OPTIONAL,
 * additive fields (design doc §4/§3.11) — provenance of a template-backed
 * blueprint pre-filled via `resolveExamBlueprint()`. They carry no
 * validation rules of their own here: omitting them is the existing,
 * fully-valid `manual` path, and `validateCreateExamInput()` below is
 * intentionally left untouched by their presence.
 */
export interface CreateExamInput {
  readonly title: string | undefined;
  readonly gradeLevel: string | undefined;
  readonly blueprint: readonly CreateExamBlueprintRowInput[] | undefined;
  readonly examType?: string;
  readonly universityId?: string;
  readonly trackId?: string;
  readonly cycleId?: string;
  readonly weekNumber?: number;
}

export type CreateExamValidation =
  { readonly ok: true } | { readonly ok: false; readonly errors: readonly string[] };

const VALID_DIFFICULTIES = new Set<string>(Object.values(Difficulty));

/**
 * Shared `gradeLevel` + `blueprint` validation, factored out so
 * `validatePreviewExamInput` (B2) can reuse the EXACT same rules minus the
 * `title` requirement (B2-R4) without duplicating them. Mutates `errors` in
 * place (collect-every-error convention).
 */
export function validateGradeLevelAndBlueprint(
  gradeLevel: string | undefined,
  blueprint: readonly CreateExamBlueprintRowInput[] | undefined,
  errors: string[],
): void {
  if (!gradeLevel || !isGradeLevel(gradeLevel)) {
    errors.push("gradeLevel is required and must be a valid catalog value");
  }
  if (!blueprint || blueprint.length === 0) {
    errors.push("blueprint must contain at least one row");
  } else {
    blueprint.forEach((row, index) => {
      if (!row.courseId) {
        errors.push(`blueprint[${index}].courseId is required`);
      }
      if (row.difficulty !== undefined && !VALID_DIFFICULTIES.has(row.difficulty)) {
        errors.push(`blueprint[${index}].difficulty must be one of: easy, medium, hard`);
      }
      if (row.count === undefined || !Number.isInteger(row.count) || row.count <= 0) {
        errors.push(`blueprint[${index}].count must be a positive integer`);
      }
    });
  }
}

/**
 * Validates the create-exam request shape (design doc 5.3 step 1-2): a
 * title, a valid `gradeLevel` catalog value, and at least one blueprint row.
 * Each row requires `courseId` and a positive integer `count`; `topicId` and
 * `difficulty` are optional (a row may target an entire course at any
 * difficulty), matching `BlueprintRow` in `blueprint-selector.ts`. Collects
 * EVERY violated rule, naming the row index for blueprint-level errors, so
 * the caller can surface a complete error list in one response.
 */
export function validateCreateExamInput(input: CreateExamInput): CreateExamValidation {
  const errors: string[] = [];

  if (!input.title || input.title.trim().length === 0) {
    errors.push("title is required");
  }
  validateGradeLevelAndBlueprint(input.gradeLevel, input.blueprint, errors);

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
