import { Rng, shuffleArray } from "./ports/random.port";

/**
 * A question that has already been selected into the exam, carrying only
 * what the shuffler needs: its identity and its correct answer.
 *
 * `type='image'` questions never have their alternatives shuffled (the
 * enunciado + alternatives live baked into the image) — `correctAnswer` is
 * an opaque, caller-supplied answer letter that passes straight through to
 * the version's `answerKey`, unchanged by question reordering.
 *
 * `type='structured'` questions (design doc §5.4) DO have their
 * `alternatives` shuffled per version. `correctAnswer` is the 0-based index
 * into `alternatives` (string form), matching the bank layer's convention
 * (`validate-create-structured-question.ts`) — NOT the final answer letter,
 * since that letter only exists after this shuffler picks a permutation.
 *
 * `type` mirrors the `ExamPdfQuestion` discriminated union in
 * `pdf-compiler.port.ts` (image optional/defaulted, structured explicit) so
 * mapping between the two layers stays mechanical.
 */
export interface SelectedImageQuestion {
  readonly type?: "image";
  readonly questionId: string;
  readonly correctAnswer: string;
}

export interface SelectedStructuredQuestion {
  readonly type: "structured";
  readonly questionId: string;
  readonly alternatives: readonly string[];
  readonly correctAnswer: string;
}

export type SelectedQuestion = SelectedImageQuestion | SelectedStructuredQuestion;

/**
 * One printed exam version (Form A/B/C...).
 *
 * INVARIANT (release gate): for every position `i` in `questionOrder`,
 * `answerKey[i]` MUST equal the answer LETTER that identifies the correct
 * alternative for the question now sitting at `questionOrder[i]` —
 * unchanged (pass-through) for `type='image'` questions, or recomputed from
 * the post-shuffle position of the originally-correct alternative for
 * `type='structured'` questions. This must hold no matter how the
 * questions AND their alternatives were permuted — the answer key always
 * follows the content, not the original position.
 *
 * `shuffledAlternatives` holds the post-shuffle alternative texts for
 * `type='structured'` questions only, keyed by `questionId`, in the exact
 * order they should be printed (so `answerKey[i]`'s letter is a direct
 * index into this array). `type='image'` questions are absent from this
 * map — their alternatives are baked into the image and never shuffled.
 */
export interface Version {
  readonly code: string;
  readonly questionOrder: string[];
  readonly answerKey: Record<number, string>;
  readonly shuffledAlternatives: Record<string, readonly string[]>;
}

const MAX_DISTINCTNESS_RETRIES = 50;

/**
 * Builds `versionCount` shuffled versions from the selected questions.
 *
 * - Each version gets a fresh permutation of `questionOrder` via the
 *   injected `rng` (deterministic under a fixed seed).
 * - For every `type='structured'` question landing in that version, its
 *   `alternatives` are ALSO freshly permuted via the same `rng` stream
 *   (still fully deterministic under a fixed seed) — `type='image'`
 *   questions are left untouched.
 * - `answerKey` is computed AFTER both shufflings, from the permuted
 *   question order and (for structured questions) the permuted
 *   alternatives, so it always points to the right answer regardless of
 *   position.
 * - The function best-effort avoids producing two versions with the exact
 *   same question order (retries a bounded number of times) but degrades
 *   gracefully when the pool is too small to guarantee distinctness (e.g.
 *   n=1 or n=2 with versionCount > n!).
 */
export function buildVersions(
  selected: readonly SelectedQuestion[],
  versionCount: number,
  rng: Rng,
): Version[] {
  if (selected.length === 0) {
    return [];
  }

  const questionIds = selected.map((q) => q.questionId);
  const questionById = new Map(selected.map((q) => [q.questionId, q]));
  const seenOrders = new Set<string>();
  const versions: Version[] = [];

  for (let versionIndex = 0; versionIndex < versionCount; versionIndex++) {
    let questionOrder = shuffleArray(questionIds, rng);
    let attempts = 0;
    while (
      seenOrders.has(questionOrder.join("|")) &&
      attempts < MAX_DISTINCTNESS_RETRIES
    ) {
      questionOrder = shuffleArray(questionIds, rng);
      attempts++;
    }
    seenOrders.add(questionOrder.join("|"));

    const answerKey: Record<number, string> = {};
    const shuffledAlternatives: Record<string, readonly string[]> = {};

    questionOrder.forEach((questionId, position) => {
      const question = questionById.get(questionId)!;
      if (question.type === "structured") {
        const { alternatives, answerLetter } = shuffleStructuredAlternatives(
          question,
          rng,
        );
        shuffledAlternatives[questionId] = alternatives;
        answerKey[position] = answerLetter;
      } else {
        answerKey[position] = question.correctAnswer;
      }
    });

    versions.push({
      code: versionCodeFor(versionIndex),
      questionOrder,
      answerKey,
      shuffledAlternatives,
    });
  }

  return versions;
}

/**
 * Permutes one structured question's `alternatives` and reports back the
 * NEW position (as an answer letter) of whichever alternative was
 * originally correct.
 *
 * Tracks the correct alternative by its ORIGINAL INDEX (not by string
 * equality) so duplicate alternative texts can never point the answer key
 * at the wrong option.
 */
function shuffleStructuredAlternatives(
  question: SelectedStructuredQuestion,
  rng: Rng,
): { alternatives: string[]; answerLetter: string } {
  const originalIndex = Number(question.correctAnswer);
  const indices = question.alternatives.map((_, index) => index);
  const shuffledIndices = shuffleArray(indices, rng);
  const alternatives = shuffledIndices.map((index) => question.alternatives[index]);
  const newPosition = shuffledIndices.indexOf(originalIndex);

  return { alternatives, answerLetter: alternativeLetterFor(newPosition) };
}

/**
 * 0-based index -> single uppercase letter (A, B, C, ...). Structured
 * questions realistically carry a handful of alternatives (see
 * `ALTERNATIVE_LETTERS` in the Typst PDF renderer, capped at 8), so a bare
 * A-Z mapping is sufficient — no bijective base-26 wraparound needed here
 * (unlike `versionCodeFor`, which must support versionCount > 26).
 */
function alternativeLetterFor(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

/**
 * Sequential version codes: A, B, C, ..., Z, AA, AB, ... (bijective base-26,
 * same scheme as spreadsheet column names). Handles versionCount > 26
 * gracefully even though real exams won't realistically need it.
 */
function versionCodeFor(index: number): string {
  let n = index + 1;
  let code = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    code = String.fromCharCode(65 + remainder) + code;
    n = Math.floor((n - 1) / 26);
  }
  return code;
}
