import { Rng, shuffleArray } from "./ports/random.port";

/**
 * A question that has already been selected into the exam, carrying only
 * what the shuffler needs: its identity and its correct answer.
 *
 * MVP scope note: image questions never have their alternatives shuffled
 * (the alternatives live baked into the image). This shuffler therefore
 * only ever reorders QUESTIONS, never alternatives.
 */
export interface SelectedQuestion {
  readonly questionId: string;
  readonly correctAnswer: string;
}

/**
 * One printed exam version (Form A/B/C...).
 *
 * INVARIANT (release gate): for every position `i` in `questionOrder`,
 * `answerKey[i]` MUST equal the `correctAnswer` of the question now sitting
 * at `questionOrder[i]`. This must hold no matter how the questions were
 * permuted — the answer key always follows the question, not the original
 * position.
 */
export interface Version {
  readonly code: string;
  readonly questionOrder: string[];
  readonly answerKey: Record<number, string>;
}

const MAX_DISTINCTNESS_RETRIES = 50;

/**
 * Builds `versionCount` shuffled versions from the selected questions.
 *
 * - Each version gets a fresh permutation of `questionOrder` via the
 *   injected `rng` (deterministic under a fixed seed).
 * - `answerKey` is computed AFTER shuffling, from the permuted order, so it
 *   always points to the right answer regardless of position.
 * - The function best-effort avoids producing two versions with the exact
 *   same order (retries a bounded number of times) but degrades gracefully
 *   when the pool is too small to guarantee distinctness (e.g. n=1 or
 *   n=2 with versionCount > n!).
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
  const correctAnswerByQuestionId = new Map(
    selected.map((q) => [q.questionId, q.correctAnswer]),
  );
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
    questionOrder.forEach((questionId, position) => {
      answerKey[position] = correctAnswerByQuestionId.get(questionId)!;
    });

    versions.push({
      code: versionCodeFor(versionIndex),
      questionOrder,
      answerKey,
    });
  }

  return versions;
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
