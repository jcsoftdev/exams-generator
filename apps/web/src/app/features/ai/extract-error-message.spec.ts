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
      error: { statusCode: 400, message: 'Typst compile failed: unexpected token', error: 'Bad Request' },
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
});
