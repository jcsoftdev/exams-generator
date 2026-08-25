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
  /**
   * Per-alternative images, index-aligned with `alternatives` — see
   * `SelectedQuestionForGeneration` in `exams-repository.port.ts`. Absent/null
   * for a question with no per-alternative images at all. Permuted by the
   * EXACT SAME index permutation as `alternatives` (never re-shuffled
   * independently), so image N always stays attached to whichever
   * alternative it was originally paired with.
   */
  readonly alternativeImages?: readonly ({ storageKey: string; mime: string } | null)[] | null;
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
 *
 * `shuffledAlternativeImages` mirrors `shuffledAlternatives` for per-
 * alternative images: same keys (only structured questions that HAD
 * `alternativeImages`), same permutation, same index alignment — entry `i`
 * here is always the image for `shuffledAlternatives[questionId][i]`.
 */

/**
 * A PRINTED block in the booklet. An empty `label` means "no heading" (the
 * single-question preview case, and versions generated before this
 * feature).
 *
 * A block is NOT a course: UNI prints "MATEMÁTICA" as a single 40-question
 * block that covers Aritmética, Álgebra, Geometría, and Trigonometría
 * (design doc §2.2). Questions from different courses mix freely inside the
 * block — that's exactly what the real booklet does.
 */
export interface SelectionBlock {
  readonly label: string;
  readonly questions: readonly SelectedQuestion[];
}

/**
 * A section of the booklet — the "prueba" in UNI's vocabulary (E1/E2/E3), the
 * curricular area in UNCP's. `code`/`label` are `null` for a manual exam,
 * which has a single unlabeled section.
 *
 * Printed numbering restarts at every section.
 */
export interface SelectionSection {
  readonly code: string | null;
  readonly label: string | null;
  readonly blocks: readonly SelectionBlock[];
}

/** A block inside a version's frozen layout: its label plus how many questions it occupies. */
export interface SectionBlockLayout {
  readonly label: string;
  readonly count: number;
}

export interface SectionLayoutEntry {
  readonly code: string | null;
  readonly label: string | null;
  readonly blocks: readonly SectionBlockLayout[];
}

/**
 * The frozen printed structure of one version. Stores `count` and NEVER
 * `questionIds`: `questionOrder` is the only source of truth for order, and
 * the `count`s only tell the renderer where to cut (design doc §3.6).
 *
 * INVARIANT: the sum of every `count` equals the length of `questionOrder`.
 */
export type SectionLayout = readonly SectionLayoutEntry[];

export interface Version {
  readonly code: string;
  readonly questionOrder: string[];
  readonly answerKey: Record<number, string>;
  readonly shuffledAlternatives: Record<string, readonly string[]>;
  readonly shuffledAlternativeImages: Record<
    string,
    readonly ({ storageKey: string; mime: string } | null)[]
  >;
  /**
   * The printed structure of THIS form: sections in canonical order, blocks in
   * whatever shuffled order this version drew. It belongs to the version and
   * not to the exam precisely because block order changes per version
   * (design doc §3.5).
   */
  readonly sectionLayout: SectionLayout;
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
  sections: readonly SelectionSection[],
  versionCount: number,
  rng: Rng,
): Version[] {
  const allQuestions = sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.questions),
  );
  if (allQuestions.length === 0) {
    return [];
  }

  const questionById = new Map(allQuestions.map((q) => [q.questionId, q]));
  const seenOrders = new Set<string>();
  const versions: Version[] = [];

  for (let versionIndex = 0; versionIndex < versionCount; versionIndex++) {
    let laidOut = layOutOneVersion(sections, rng);
    let attempts = 0;
    while (seenOrders.has(laidOut.questionOrder.join("|")) && attempts < MAX_DISTINCTNESS_RETRIES) {
      laidOut = layOutOneVersion(sections, rng);
      attempts++;
    }
    seenOrders.add(laidOut.questionOrder.join("|"));

    const answerKey: Record<number, string> = {};
    const shuffledAlternatives: Record<string, readonly string[]> = {};
    const shuffledAlternativeImages: Record<
      string,
      readonly ({ storageKey: string; mime: string } | null)[]
    > = {};

    laidOut.questionOrder.forEach((questionId, position) => {
      const question = questionById.get(questionId)!;
      if (question.type === "structured") {
        const { alternatives, answerLetter, alternativeImages } = shuffleStructuredAlternatives(
          question,
          rng,
        );
        shuffledAlternatives[questionId] = alternatives;
        answerKey[position] = answerLetter;
        if (alternativeImages) {
          shuffledAlternativeImages[questionId] = alternativeImages;
        }
      } else {
        answerKey[position] = question.correctAnswer;
      }
    });

    versions.push({
      code: versionCodeFor(versionIndex),
      questionOrder: laidOut.questionOrder,
      answerKey,
      shuffledAlternatives,
      shuffledAlternativeImages,
      sectionLayout: laidOut.sectionLayout,
    });
  }

  return versions;
}

/**
 * One layout pass: SECTIONS are walked in their canonical order and are NEVER
 * permuted — a Chemistry question cannot land in the Mathematics prueba —
 * while inside each section the order of BLOCKS is permuted (anti-copying,
 * design doc §3.4) and inside each block its questions are permuted, mixing
 * courses and levels the way the real booklet does.
 */
function layOutOneVersion(
  sections: readonly SelectionSection[],
  rng: Rng,
): { questionOrder: string[]; sectionLayout: SectionLayoutEntry[] } {
  const questionOrder: string[] = [];
  const sectionLayout: SectionLayoutEntry[] = [];

  for (const section of sections) {
    const blocks = shuffleArray([...section.blocks], rng);
    const blockLayout: SectionBlockLayout[] = [];

    for (const block of blocks) {
      const ids = shuffleArray(
        block.questions.map((question) => question.questionId),
        rng,
      );
      questionOrder.push(...ids);
      blockLayout.push({ label: block.label, count: ids.length });
    }

    sectionLayout.push({ code: section.code, label: section.label, blocks: blockLayout });
  }

  return { questionOrder, sectionLayout };
}

/**
 * Permutes one structured question's `alternatives` and reports back the
 * NEW position (as an answer letter) of whichever alternative was
 * originally correct.
 *
 * Tracks the correct alternative by its ORIGINAL INDEX (not by string
 * equality) so duplicate alternative texts can never point the answer key
 * at the wrong option.
 *
 * `alternativeImages`, when present, is permuted by the EXACT SAME
 * `shuffledIndices` array used for `alternatives` — a single shuffle, reused
 * for both parallel arrays — so image N stays attached to whichever
 * text/position it was originally paired with, never re-shuffled
 * independently.
 */
function shuffleStructuredAlternatives(
  question: SelectedStructuredQuestion,
  rng: Rng,
): {
  alternatives: string[];
  answerLetter: string;
  alternativeImages?: readonly ({ storageKey: string; mime: string } | null)[];
} {
  const originalIndex = Number(question.correctAnswer);
  const indices = question.alternatives.map((_, index) => index);
  const shuffledIndices = shuffleArray(indices, rng);
  const alternatives = shuffledIndices.map((index) => question.alternatives[index]);
  const newPosition = shuffledIndices.indexOf(originalIndex);
  const alternativeImages = question.alternativeImages
    ? shuffledIndices.map((index) => question.alternativeImages![index] ?? null)
    : undefined;

  return { alternatives, answerLetter: alternativeLetterFor(newPosition), alternativeImages };
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
