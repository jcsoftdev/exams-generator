import { correctAnswerLabel, gradeLevelLabel } from './question-display.util';

/**
 * Audit 2026-08-20 (M1/L3): the bank list/detail rendered the STORED
 * `correctAnswer` verbatim — a 0-based index ("Clave: 0") for structured
 * questions next to a letter ("Clave: d") for image questions — and the raw
 * grade code ("Grado: pre"). Teachers read keys as letters and grades as
 * labels; the storage conventions must never leak into the panel.
 */
describe('correctAnswerLabel', () => {
  it('maps a structured 0-based index to its letter', () => {
    expect(correctAnswerLabel('0')).toBe('a');
    expect(correctAnswerLabel('3')).toBe('d');
    expect(correctAnswerLabel('4')).toBe('e');
  });

  it('passes an image-question letter through unchanged', () => {
    expect(correctAnswerLabel('d')).toBe('d');
    expect(correctAnswerLabel('a')).toBe('a');
  });

  it('passes anything non-numeric through untouched rather than guessing', () => {
    expect(correctAnswerLabel('')).toBe('');
    expect(correctAnswerLabel('10x')).toBe('10x');
  });

  it('leaves out-of-range indexes untouched (no letter beyond z, no negatives)', () => {
    expect(correctAnswerLabel('-1')).toBe('-1');
    expect(correctAnswerLabel('26')).toBe('26');
  });
});

describe('gradeLevelLabel', () => {
  it('maps known grade codes to their user-facing label', () => {
    expect(gradeLevelLabel('pre')).toBe('Pre-admisión');
    expect(gradeLevelLabel('secundaria_4')).toBe('4° secundaria');
  });

  it('falls back to the raw code for an unknown grade', () => {
    expect(gradeLevelLabel('mystery_level')).toBe('mystery_level');
  });
});
