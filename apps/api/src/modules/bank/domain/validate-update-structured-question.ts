import { validateStructuredContent } from "./validate-structured-content";

export interface UpdateStructuredQuestionPatch {
  readonly bodyTypst?: string;
  readonly alternatives?: readonly string[];
  readonly correctAnswer?: string;
  /** `undefined` = leave unchanged; `""` explicitly clears the figure. */
  readonly figureCode?: string;
}

export interface StructuredQuestionContent {
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  readonly correctAnswer: string;
  readonly figureCode: string | undefined;
}

export type UpdateStructuredQuestionValidation =
  | { readonly ok: true; readonly merged: StructuredQuestionContent }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Validates a `PATCH /bank/questions/:id` body (Lane D3: "un humano pueda
 * editar el draft antes de aprobar"). Every field is OPTIONAL in the patch —
 * this merges it over the draft's CURRENT content first, then re-validates
 * the merged result with the SAME rules `validateCreateStructuredQuestionInput`
 * uses for content (`validateStructuredContent`), so an edit can never leave
 * the draft in a shape creation itself would have rejected (e.g. changing
 * `alternatives` to 2 entries while `correctAnswer` still points at index 4).
 */
export function validateUpdateStructuredQuestionInput(
  patch: UpdateStructuredQuestionPatch,
  current: StructuredQuestionContent,
): UpdateStructuredQuestionValidation {
  const merged: StructuredQuestionContent = {
    bodyTypst: patch.bodyTypst ?? current.bodyTypst,
    alternatives: patch.alternatives ?? current.alternatives,
    correctAnswer: patch.correctAnswer ?? current.correctAnswer,
    figureCode: patch.figureCode !== undefined ? patch.figureCode : current.figureCode,
  };

  const errors = validateStructuredContent(merged);

  return errors.length > 0 ? { ok: false, errors } : { ok: true, merged };
}
