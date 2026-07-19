import { Difficulty } from "@exams-generator/shared";

export interface QuestionTaxonomyPatch {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: string;
  readonly gradeLevel?: string;
}

export type TaxonomyValidation = { readonly ok: true } | { readonly ok: false; readonly errors: readonly string[] };

const DIFFICULTIES = new Set<string>(Object.values(Difficulty));

export function validateQuestionTaxonomy(patch: QuestionTaxonomyPatch): TaxonomyValidation {
  const errors: string[] = [];
  const nonBlank = (v: string | undefined, name: string) => {
    if (v !== undefined && v.trim() === "") errors.push(`${name} must not be blank`);
  };
  nonBlank(patch.courseId, "courseId");
  nonBlank(patch.topicId, "topicId");
  nonBlank(patch.gradeLevel, "gradeLevel");
  if (patch.difficulty !== undefined && !DIFFICULTIES.has(patch.difficulty)) {
    errors.push(`difficulty must be one of ${[...DIFFICULTIES].join(", ")}`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
