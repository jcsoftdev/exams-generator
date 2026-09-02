import { Course, Topic } from '../taxonomy/taxonomy.models';

/**
 * Extracted from `bank-new.component.ts` (Line G split, audit M10) — pure
 * functions with no Angular/DI dependencies, moved verbatim so their
 * behavior (and every doc comment explaining WHY) is unchanged. Covered by
 * `taxonomy-matcher.spec.ts` directly; `bank-new.component.spec.ts`'s
 * feature-level tests still exercise them indirectly through
 * `extractWithAi()`/`submitStructured()`.
 */

export const CORRECT_ANSWER_LETTERS = ['a', 'b', 'c', 'd', 'e'];

/**
 * `ExtractQuestionService`/`ReviseQuestionService` return `correctAnswer` as
 * a 0-based INDEX (bank storage/PATCH convention) — but this UI's "Clave"
 * field is letter-labeled (a/b/c/d/e) and manual entry into it is also a
 * letter. Converting at this boundary keeps `sCorrectAnswer` ALWAYS a
 * letter, whether it got there by typing or by AI autofill.
 *
 * The extraction can also come back with `correctAnswer: null` when the
 * model couldn't read a clave from the photo at all (B1) — the parameter is
 * typed as the union so that shape is handled explicitly even against
 * today's non-nullable `AiRevisedQuestion.correctAnswer`, which still
 * assigns into it fine. `null` means "leave the field empty for the teacher
 * to fill in", never a prefilled guess.
 */
export function indexToCorrectAnswerLetter(index: string | null): string {
  if (index === null) return '';
  const letter = CORRECT_ANSWER_LETTERS[Number(index)];
  return letter ?? index;
}

/** Inverse of `indexToCorrectAnswerLetter` — used right before the wire call, which still expects the 0-based index. */
export function correctAnswerLetterToIndex(letter: string): string {
  const index = CORRECT_ANSWER_LETTERS.indexOf(letter.trim().toLowerCase());
  return index === -1 ? letter : String(index);
}

/** Accent/case/whitespace-insensitive compare — the AI's course/topic guess won't always match the DB's exact casing. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** Course names are a small, standard catalog (Aritmética, Comunicación...) — an exact normalized match is reliable. */
export function findCourseMatch(
  courses: readonly Course[],
  guess: string | undefined,
): Course | undefined {
  if (!guess) return undefined;
  const normalizedGuess = normalizeForMatch(guess);
  return courses.find((course) => normalizeForMatch(course.name) === normalizedGuess);
}

/** Topic names are long/compound (e.g. "sintaxis - complementos oracionales (complemento agente)") — substring containment either way is more forgiving than an exact match. */
export function findTopicMatch(
  topics: readonly Topic[],
  guess: string | undefined,
): Topic | undefined {
  if (!guess) return undefined;
  const normalizedGuess = normalizeForMatch(guess);
  return topics.find((topic) => {
    const normalizedName = normalizeForMatch(topic.name);
    return (
      normalizedName === normalizedGuess ||
      normalizedName.includes(normalizedGuess) ||
      normalizedGuess.includes(normalizedName)
    );
  });
}
