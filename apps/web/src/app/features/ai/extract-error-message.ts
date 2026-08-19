import { HttpErrorResponse } from '@angular/common/http';

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

  if (Array.isArray(body)) {
    return body.join(', ');
  }

  if (body && typeof body === 'object' && 'message' in body && error.status < 500) {
    const message = (body as { message: unknown }).message;
    return Array.isArray(message) ? message.join(', ') : String(message);
  }

  return fallback;
}
