import { Difficulty } from "@exams-generator/shared";
import { isGradeLevel } from "../../exams/domain/value-objects/grade-level";

/**
 * `courseId` is intentionally NOT a field here — `questions` has no
 * `course_id` column (see `questions.schema.ts`); a question's course is
 * always derived by joining `topics.course_id` through `topicId`. Moving a
 * question to a different course means moving it to a topic that belongs to
 * that course, i.e. changing `topicId`.
 */
export interface QuestionTaxonomyPatch {
  readonly topicId?: string;
  readonly difficulty?: string;
  readonly gradeLevel?: string;
}

export type TaxonomyValidation =
  { readonly ok: true } | { readonly ok: false; readonly errors: readonly string[] };

const DIFFICULTIES = new Set<string>(Object.values(Difficulty));

/**
 * Pure (no DB access) shape/catalog validation for a taxonomy patch.
 * `topicId` is only checked for blankness here — its FK existence against
 * the `topics` table is a DB-backed check the caller (`BankService.editQuestion`)
 * performs separately, up front, before any write.
 */
export function validateQuestionTaxonomy(patch: QuestionTaxonomyPatch): TaxonomyValidation {
  const errors: string[] = [];
  const nonBlank = (v: string | undefined, name: string) => {
    if (v !== undefined && v.trim() === "") errors.push(`${name} must not be blank`);
  };
  nonBlank(patch.topicId, "topicId");
  if (patch.gradeLevel !== undefined && !isGradeLevel(patch.gradeLevel)) {
    errors.push("gradeLevel must be a valid catalog value");
  }
  if (patch.difficulty !== undefined && !DIFFICULTIES.has(patch.difficulty)) {
    errors.push(`difficulty must be one of ${[...DIFFICULTIES].join(", ")}`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
