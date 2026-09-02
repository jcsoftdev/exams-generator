import { HttpErrorResponse } from '@angular/common/http';
import { describe, it, expect } from 'vitest';
import { extractErrorMessage } from './extract-error-message';

/**
 * The bank API's `PATCH /bank/questions/:id` 400 response has two shapes
 * depending on which validation step fails (see
 * apps/api/src/modules/bank/bank.service.ts `editDraftQuestion`):
 *   - `BadRequestException(validation.errors)` → body IS the array itself
 *   - `BadRequestException("Typst compile failed: ...")` → body is
 *     `{ statusCode, message: string, error: "Bad Request" }`
 * `extractErrorMessage` normalizes both into one human-readable string.
 */
describe('extractErrorMessage', () => {
  it('joins the body when it is an array of validation error strings', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: ['correctAnswer is required', 'alternatives must have 5 items'],
    });

    expect(extractErrorMessage(error)).toBe(
      'correctAnswer is required, alternatives must have 5 items',
    );
  });

  it('reads a plain string message from a wrapped Nest error body', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: {
        statusCode: 400,
        message: 'Typst compile failed: unexpected token',
        error: 'Bad Request',
      },
    });

    expect(extractErrorMessage(error)).toBe('Typst compile failed: unexpected token');
  });

  it('joins an array message inside a wrapped Nest error body', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: { statusCode: 400, message: ['bodyTypst is required'], error: 'Bad Request' },
    });

    expect(extractErrorMessage(error)).toBe('bodyTypst is required');
  });

  it('falls back to a generic message when the body has no recognizable shape', () => {
    const error = new HttpErrorResponse({ status: 500, error: null });

    expect(extractErrorMessage(error)).toBe('No se pudo guardar la pregunta. Inténtalo de nuevo.');
  });

  /**
   * Audit finding P1: Nest's default exception filter wraps ANY unhandled
   * 500 in `{ statusCode, message: "Internal server error", error }` — the
   * exact same shape as a 400's actionable `message`, but this one is
   * generic, untranslated, and tells the teacher nothing. Only a 4xx
   * `message` is worth showing verbatim (validation errors, Typst compile
   * stderr); a 5xx body's `message` must fall back to the Spanish wording.
   */
  it('falls back to the Spanish message on a 500, even when the body carries a generic Nest "message"', () => {
    const error = new HttpErrorResponse({
      status: 500,
      error: { statusCode: 500, message: 'Internal server error', error: 'Internal Server Error' },
    });

    expect(extractErrorMessage(error)).toBe('No se pudo guardar la pregunta. Inténtalo de nuevo.');
  });

  /**
   * B10 (audit A2, web half): a 503 with `{ code: "ai_not_configured" }`
   * means the school's tenant has no AI provider set up at all — not a
   * transient failure, so the message must not suggest retrying (unlike
   * every other branch above, which does).
   *
   * B10 follow-up (adversarial fix round): this helper is SHARED by
   * exam-review, bank-list, and ai-review-queue — none of which show a
   * photo. The old wording ("Escribe la pregunta o guarda la foto tal
   * cual.") only makes sense on bank-new's photo tab, so the helper now
   * returns the neutral half only; bank-new appends its own photo-specific
   * sentence on top (see bank-new.component.spec.ts's B10 test).
   */
  it('returns the neutral ai-not-configured wording for a 503 carrying { code: "ai_not_configured" }, without suggesting a retry', () => {
    const error = new HttpErrorResponse({
      status: 503,
      error: { code: 'ai_not_configured', message: 'AI is not configured for this tenant' },
    });

    const message = extractErrorMessage(error);
    expect(message).toBe('La IA no está habilitada en este colegio.');
    expect(message.toLowerCase()).not.toContain('inténtalo de nuevo');
    // Photo-specific wording is bank-new's own responsibility, not this
    // shared helper's — exam-review/bank-list/ai-review-queue never show a
    // photo tab.
    expect(message).not.toContain('foto');
  });

  it('falls back to the generic 5xx wording for a 503 that does NOT carry the ai_not_configured code', () => {
    const error = new HttpErrorResponse({
      status: 503,
      error: { message: 'Service Unavailable' },
    });

    expect(extractErrorMessage(error)).toBe('No se pudo guardar la pregunta. Inténtalo de nuevo.');
  });
});
