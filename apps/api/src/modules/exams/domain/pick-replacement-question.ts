import { BlueprintRowRecord, QuestionPoolCandidateRecord } from "./ports/exams-repository.port";
import { Rng, shuffleArray } from "./ports/random.port";

/**
 * Whether a bank candidate satisfies one blueprint row's cell. `topicId` and
 * `difficulty` are optional on the row: a row that does not constrain them
 * accepts any value, which is how course-level rows ("15 de Aritmética,
 * cualquier tema") are expressed.
 */
export function matchesRowCriteria(candidate: QuestionPoolCandidateRecord, row: BlueprintRowRecord): boolean {
  if (candidate.courseId !== row.courseId) {
    return false;
  }
  if (row.topicId !== undefined && candidate.topicId !== row.topicId) {
    return false;
  }
  if (row.difficulty !== undefined && candidate.difficulty !== row.difficulty) {
    return false;
  }
  return true;
}

export interface PickReplacementInput {
  readonly pool: readonly QuestionPoolCandidateRecord[];
  readonly row: BlueprintRowRecord;
  /**
   * Questions this row must NOT be refilled with: everything already selected
   * into the exam (no duplicates within one paper) plus anything already
   * proven to break compilation during this run (never swap a bad question
   * for another bad question, and never swap it back in).
   */
  readonly excludedIds: ReadonlySet<string>;
  readonly rng: Rng;
}

/**
 * Picks a stand-in for one blueprint row's slot, honouring exactly the same
 * cell criteria the original selection used, or `undefined` when the row is
 * exhausted.
 *
 * Shared by the human "reroll this question" flow (`ExamsService`) and the
 * automatic swap the generator performs when a question turns out not to
 * compile — the two must agree on what a legal replacement is, or a
 * generated paper could silently drift off its own blueprint.
 */
export function pickReplacementQuestion(input: PickReplacementInput): string | undefined {
  const matching = input.pool.filter(
    (candidate) => matchesRowCriteria(candidate, input.row) && !input.excludedIds.has(candidate.id),
  );
  if (matching.length === 0) {
    return undefined;
  }
  return shuffleArray(matching, input.rng)[0]!.id;
}
