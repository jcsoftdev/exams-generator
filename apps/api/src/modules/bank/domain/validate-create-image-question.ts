import { Difficulty } from "@exams-generator/shared";
import { isGradeLevel } from "../../exams/domain/value-objects/grade-level";

/**
 * Pure input shape the controller/service maps its raw request into before
 * validating. `hasImage` is a boolean (not the file itself) so this stays a
 * pure function testable without touching multer/Express types.
 */
export interface CreateImageQuestionInput {
  readonly courseId: string | undefined;
  readonly topicId: string | undefined;
  readonly difficulty: string | undefined;
  readonly gradeLevel: string | undefined;
  readonly correctAnswer: string | undefined;
  readonly hasImage: boolean;
}

export type CreateImageQuestionValidation =
  { readonly ok: true } | { readonly ok: false; readonly errors: readonly string[] };

const VALID_DIFFICULTIES = new Set<string>(Object.values(Difficulty));

/**
 * Manual-upload validation per design doc 5.1: course, topic, difficulty,
 * grade level, the answer key, and the image itself are all required —
 * there is no draft state for manual uploads (curated by definition), so
 * anything that passes this check goes straight to `status = 'approved'`.
 * Collects EVERY violated rule (not just the first) so the caller can
 * surface a complete error list in one response.
 */
export function validateCreateImageQuestionInput(
  input: CreateImageQuestionInput,
): CreateImageQuestionValidation {
  const errors: string[] = [];

  if (!input.courseId) {
    errors.push("courseId is required");
  }
  if (!input.topicId) {
    errors.push("topicId is required");
  }
  if (!input.difficulty || !VALID_DIFFICULTIES.has(input.difficulty)) {
    errors.push("difficulty is required and must be one of: easy, medium, hard");
  }
  if (!input.gradeLevel || !isGradeLevel(input.gradeLevel)) {
    errors.push("gradeLevel is required and must be a valid catalog value");
  }
  if (!input.correctAnswer || input.correctAnswer.trim().length === 0) {
    errors.push("correctAnswer is required");
  }
  if (!input.hasImage) {
    errors.push("image file is required");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
