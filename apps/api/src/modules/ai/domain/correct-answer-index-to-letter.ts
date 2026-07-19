const LETTERS = ["a", "b", "c", "d", "e"];

/**
 * Inverse of `correctAnswerLetterToIndex`. The `questions` table stores
 * `correct_answer` as a 0-based INDEX into `alternatives` (bank
 * storage/PATCH convention), but `QuestionGeneratorPort.reviseQuestion()`'s
 * `ReviseQuestionInput.current.correctAnswer` — like `GeneratedQuestion` —
 * expects a LETTER ("a".."e"). This is the ONE place that conversion
 * happens, so `ReviseQuestionService` never hand-rolls the mapping inline.
 */
export function correctAnswerIndexToLetter(index: string): string {
  const parsed = Number(index);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= LETTERS.length) {
    throw new Error(`Unrecognized correctAnswer index from bank storage: "${index}"`);
  }
  return LETTERS[parsed];
}
