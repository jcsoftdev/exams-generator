const LETTERS = ["a", "b", "c", "d", "e"];

/**
 * `QuestionGeneratorPort.generate()` returns `correctAnswer` as a letter
 * ("a".."e", see `GeneratedQuestion`), but the `questions` table stores
 * `correct_answer` as a 0-based index into `alternatives` (same convention
 * `validateCreateStructuredQuestionInput` enforces for manual creation —
 * design doc §5.1: "índice de la correcta"). This is the ONE place that
 * conversion happens, so both storage paths stay consistent.
 *
 * Overloaded for `ExtractedQuestion.correctAnswer` (`extractFromImage()`'s
 * own, more permissive shape — see `question-generator.port.ts`), whose
 * `correctAnswer` may be `null` when the photo doesn't show/imply a key: a
 * `null` in, `null` out passthrough, distinct from the non-null overload
 * that still throws on anything that isn't a recognized letter.
 */
export function correctAnswerLetterToIndex(letter: string): string;
export function correctAnswerLetterToIndex(letter: string | null): string | null;
export function correctAnswerLetterToIndex(letter: string | null): string | null {
  if (letter === null) {
    return null;
  }
  const index = LETTERS.indexOf(letter.toLowerCase());
  if (index === -1) {
    throw new Error(`Unrecognized correctAnswer letter from AI provider: "${letter}"`);
  }
  return String(index);
}
