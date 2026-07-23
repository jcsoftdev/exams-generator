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
 */
export function extractErrorMessage(error: HttpErrorResponse): string {
  const body = error.error as unknown;

  if (Array.isArray(body)) {
    return body.join(', ');
  }

  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message: unknown }).message;
    return Array.isArray(message) ? message.join(', ') : String(message);
  }

  return 'No se pudo guardar la pregunta. Inténtalo de nuevo.';
}
