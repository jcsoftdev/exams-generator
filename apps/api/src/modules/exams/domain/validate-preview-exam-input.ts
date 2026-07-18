import { CreateExamBlueprintRowInput, validateGradeLevelAndBlueprint } from "./validate-create-exam-input";

/** Same shape as `CreateExamInput` minus `title` (B2-R4). */
export interface PreviewExamInput {
  readonly gradeLevel: string | undefined;
  readonly blueprint: readonly CreateExamBlueprintRowInput[] | undefined;
}

export type PreviewExamValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Validates `POST /exams/preview` (B2-R4): reuses `validateCreateExamInput`'s
 * `gradeLevel` + `blueprint` rules verbatim via
 * `validateGradeLevelAndBlueprint()` — the only difference from
 * `validateCreateExamInput` is that `title` is never checked.
 */
export function validatePreviewExamInput(input: PreviewExamInput): PreviewExamValidation {
  const errors: string[] = [];
  validateGradeLevelAndBlueprint(input.gradeLevel, input.blueprint, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
