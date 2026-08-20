import { GRADE_LEVEL_LABELS, GradeLevel } from './bank.models';

/**
 * User-facing "Clave" for a bank question (audit 2026-08-20 M1).
 *
 * Storage keeps two by-design conventions (`version-shuffler.ts`):
 * structured questions store the correct alternative as a 0-based INDEX
 * ("0".."4"), image questions store the final answer LETTER ("a".."e").
 * Teachers only ever think in letters, so a purely-numeric value is
 * converted; anything else (already a letter) passes through. Numeric is a
 * safe discriminator — no image lot stores digits as its answer letter.
 */
export function correctAnswerLabel(correctAnswer: string): string {
  if (!/^\d+$/.test(correctAnswer)) {
    return correctAnswer;
  }
  const index = Number(correctAnswer);
  if (index > 25) {
    return correctAnswer;
  }
  return String.fromCharCode(97 + index);
}

/** "pre" -> "Pre-admisión" etc.; unknown codes fall back to the raw value (audit 2026-08-20 L3). */
export function gradeLevelLabel(gradeLevel: string): string {
  return GRADE_LEVEL_LABELS[gradeLevel as GradeLevel] ?? gradeLevel;
}
