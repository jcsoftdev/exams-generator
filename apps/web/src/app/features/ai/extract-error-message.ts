import { HttpErrorResponse } from '@angular/common/http';

/**
 * Normalizes the two 400 body shapes `PATCH /bank/questions/:id` can send
 * (see apps/api/src/modules/bank/bank.service.ts `editDraftQuestion`):
 *   - `BadRequestException(validation.errors)` → body IS the array itself
 *   - `BadRequestException("Typst compile failed: ...")` → body is
 *     `{ statusCode, message, error }` (Nest's default wrapping for a
 *     string response)
 * into a single human-readable string for the review-queue edit form.
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

  return 'Could not save changes. Please review the Typst markup.';
}
