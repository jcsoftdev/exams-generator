import { Difficulty } from "@exams-generator/shared";
import { isGradeLevel } from "../../exams/domain/value-objects/grade-level";
import { validateStructuredContent } from "./validate-structured-content";

/**
 * Pure input shape the controller/service maps its raw request into before
 * validating. Mirrors `validate-create-image-question.ts`'s shape but for
 * `type = 'structured'` questions (design doc §3/§5.4): a Typst-markup
 * `bodyTypst` statement, a JSON `alternatives` array, an optional CeTZ
 * `figureCode`, and `correctAnswer` as a 0-based index into `alternatives`
 * (design doc §5.1: "índice de la correcta").
 */
export interface CreateStructuredQuestionInput {
  readonly courseId: string | undefined;
  readonly topicId: string | undefined;
  readonly difficulty: string | undefined;
  readonly gradeLevel: string | undefined;
  readonly bodyTypst: string | undefined;
  readonly alternatives: readonly string[] | undefined;
  readonly correctAnswer: string | undefined;
  readonly figureCode: string | undefined;
}

export type CreateStructuredQuestionValidation =
  { readonly ok: true } | { readonly ok: false; readonly errors: readonly string[] };

const VALID_DIFFICULTIES = new Set<string>(Object.values(Difficulty));

/**
 * Manual structured-question creation validation. Unlike image uploads,
 * there is no file to check; instead `bodyTypst` + `alternatives` must be
 * non-blank and `correctAnswer` must resolve to a real index into
 * `alternatives` (bounds-checked here so a bad index never reaches the DB).
 * Collects EVERY violated rule (not just the first), same pattern as
 * `validateCreateImageQuestionInput`.
 */
export function validateCreateStructuredQuestionInput(
  input: CreateStructuredQuestionInput,
): CreateStructuredQuestionValidation {
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

  errors.push(
    ...validateStructuredContent({
      bodyTypst: input.bodyTypst,
      alternatives: input.alternatives,
      correctAnswer: input.correctAnswer,
    }),
  );

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
