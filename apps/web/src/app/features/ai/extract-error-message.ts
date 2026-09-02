import { HttpErrorResponse } from '@angular/common/http';

/**
 * The exact neutral wording `extractErrorMessage` returns for a 503
 * `{ code: "ai_not_configured" }` — exported so bank-new can compare
 * against it and append its own photo-specific sentence, without either
 * side hardcoding a copy of the other's string (see the doc comment on
 * `extractErrorMessage` below).
 */
export const AI_NOT_CONFIGURED_MESSAGE = 'La IA no está habilitada en este colegio.';

/**
 * Normalizes the two 400 body shapes `PATCH /bank/questions/:id` can send
 * (see apps/api/src/modules/bank/bank.service.ts `editDraftQuestion`):
 *   - `BadRequestException(validation.errors)` → body IS the array itself
 *   - `BadRequestException("Typst compile failed: ...")` → body is
 *     `{ statusCode, message, error }` (Nest's default wrapping for a
 *     string response)
 * into a single human-readable string for the edit forms (AI review queue
 * and bank list) — so a server-side Typst compile failure reaches the
 * teacher verbatim instead of being swallowed by a generic "could not
 * save" banner.
 *
 * `fallback` is what to show when the body carries no message at all (a 500,
 * a network failure, an opaque proxy error). It defaults to the bank-edit
 * wording this helper was written for; the exam-review screen passes its own
 * (audit 2026-08-15 — it was showing a generic "inténtalo de nuevo" even for
 * 400s that DID explain themselves).
 *
 * `error.status >= 500` always falls back too, even when the body DOES carry
 * a `message` — Nest's default exception filter wraps every unhandled
 * server error in the exact same shape as a validation 400
 * (`{ statusCode, message, error }`), but that `message` is the generic,
 * untranslated `"Internal server error"`, not an actionable explanation.
 * Only a 4xx `message` is specific enough (validation errors, Typst compile
 * stderr) to show the teacher verbatim — audit finding P1, "a generic 500
 * leaks English into a Spanish UI".
 */
export function extractErrorMessage(
  error: HttpErrorResponse,
  fallback = 'No se pudo guardar la pregunta. Inténtalo de nuevo.',
): string {
  const body = error.error as unknown;

  // B10 (audit A2, web half): a 503 with `{ code: "ai_not_configured" }`
  // means the school's tenant never set up an AI provider at all — not a
  // transient failure, so this is checked FIRST and returns dedicated
  // wording that does NOT invite a retry, unlike every other branch below.
  //
  // This helper is SHARED by exam-review, bank-list, ai-review-queue and
  // bank-new — only bank-new has a photo tab, so the sentence steering the
  // teacher to "write it or keep the photo as-is" belongs there, not here.
  // Returns the neutral half only; bank-new appends its own photo-specific
  // sentence on top (see bank-new.component.ts `extractWithAi`).
  if (
    error.status === 503 &&
    body &&
    typeof body === 'object' &&
    (body as { code?: unknown }).code === 'ai_not_configured'
  ) {
    return AI_NOT_CONFIGURED_MESSAGE;
  }

  if (Array.isArray(body)) {
    return body.join(', ');
  }

  if (body && typeof body === 'object' && 'message' in body && error.status < 500) {
    const message = (body as { message: unknown }).message;
    return Array.isArray(message) ? message.join(', ') : String(message);
  }

  return fallback;
}
