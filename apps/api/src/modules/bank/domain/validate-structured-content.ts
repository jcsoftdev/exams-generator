const MIN_ALTERNATIVES = 2;

export interface StructuredContentInput {
  readonly bodyTypst: string | undefined;
  readonly alternatives: readonly string[] | undefined;
  readonly correctAnswer: string | undefined;
}

/**
 * Content-only structured-question validation: `bodyTypst` +
 * `alternatives` + `correctAnswer` (0-based index bounds-checked against
 * `alternatives`). Extracted out of `validate-create-structured-question.ts`
 * so both question CREATION and the human draft-EDIT flow (Lane D3, `PATCH
 * /bank/questions/:id`) share the exact same rules — an edited draft can
 * never end up in a shape creation itself would have rejected.
 */
export function validateStructuredContent(input: StructuredContentInput): string[] {
  const errors: string[] = [];

  if (!input.bodyTypst || input.bodyTypst.trim().length === 0) {
    errors.push("bodyTypst is required");
  }

  const alternatives = input.alternatives;
  if (
    !alternatives ||
    alternatives.length < MIN_ALTERNATIVES ||
    alternatives.some((alt) => !alt || alt.trim().length === 0)
  ) {
    errors.push(`alternatives is required and must have at least ${MIN_ALTERNATIVES} non-blank entries`);
  }

  if (!input.correctAnswer) {
    errors.push("correctAnswer is required");
  } else if (alternatives && alternatives.length >= MIN_ALTERNATIVES) {
    const index = Number(input.correctAnswer);
    if (!Number.isInteger(index) || index < 0 || index >= alternatives.length) {
      errors.push("correctAnswer must be a valid 0-based index into alternatives");
    }
  }

  return errors;
}
