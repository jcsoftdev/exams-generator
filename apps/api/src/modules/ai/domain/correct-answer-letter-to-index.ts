const LETTERS = ["a", "b", "c", "d", "e"];

/**
 * `QuestionGeneratorPort.generate()` returns `correctAnswer` as a letter
 * ("a".."e", see `GeneratedQuestion`), but the `questions` table stores
 * `correct_answer` as a 0-based index into `alternatives` (same convention
 * `validateCreateStructuredQuestionInput` enforces for manual creation —
 * design doc §5.1: "índice de la correcta"). This is the ONE place that
 * conversion happens, so both storage paths stay consistent.
 *
 * Strict: the parameter is typed `string`, never `string | null`, and this
 * throws on anything that isn't a recognized letter — INCLUDING a `null`
 * that reaches it anyway (an unsafe cast, a JS caller, a boundary that lost
 * the type). It never silently hands back a `null` a `string`-typed caller
 * has no reason to check for. For `ExtractedQuestion.correctAnswer`
 * (`extractFromImage()`'s own, more permissive shape — see
 * `question-generator.port.ts`), whose `correctAnswer` may legitimately be
 * `null` when the photo doesn't show/imply a key, use
 * `correctAnswerLetterToIndexOrNull` below instead.
 */
export function correctAnswerLetterToIndex(letter: string): string {
  const index = letter === null || letter === undefined ? -1 : LETTERS.indexOf(letter.toLowerCase());
  if (index === -1) {
    throw new Error(`Unrecognized correctAnswer letter from AI provider: "${letter}"`);
  }
  return String(index);
}

/**
 * Null-safe wrapper for `ExtractedQuestion.correctAnswer` — the ONLY place
 * `null` is a legitimate input (the photo doesn't show/imply a key). A
 * `null` in gives a `null` out, unconverted; anything else is validated
 * exactly like `correctAnswerLetterToIndex` (including throwing on an
 * unrecognized letter), since it delegates there for every non-null value.
 */
export function correctAnswerLetterToIndexOrNull(letter: string | null): string | null {
  return letter === null ? null : correctAnswerLetterToIndex(letter);
}
