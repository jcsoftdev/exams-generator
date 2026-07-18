import { Difficulty } from "@exams-generator/shared";
import { isGradeLevel } from "../../exams/domain/value-objects/grade-level";

export interface GenerateQuestionsInput {
  readonly courseId: string | undefined;
  readonly topicId: string | undefined;
  readonly difficulty: string | undefined;
  readonly gradeLevel: string | undefined;
  readonly count: number | undefined;
  readonly withFigure?: boolean | undefined;
}

export type GenerateQuestionsValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly string[] };

const VALID_DIFFICULTIES = new Set<string>(Object.values(Difficulty));
const MAX_COUNT = 10;

/**
 * `POST /ai/questions/generate` body validation (design doc §5.2). `count`
 * is capped at `MAX_COUNT` — an unbounded batch could hammer the AI
 * provider's free-tier rate limit (`AiRateLimitError`) and generate an
 * unreviewable pile of drafts in one call.
 */
export function validateGenerateQuestionsInput(
  input: GenerateQuestionsInput,
): GenerateQuestionsValidation {
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
  if (
    input.count === undefined ||
    !Number.isInteger(input.count) ||
    input.count < 1 ||
    input.count > MAX_COUNT
  ) {
    errors.push(`count is required and must be an integer between 1 and ${MAX_COUNT}`);
  }
  if (input.withFigure !== undefined && typeof input.withFigure !== "boolean") {
    errors.push("withFigure must be a boolean when provided");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
