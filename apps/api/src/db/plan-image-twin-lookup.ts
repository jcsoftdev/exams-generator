import type { RetirementCandidate } from "./plan-image-question-retirement";

export interface PlanImageTwinLookupInput {
  /**
   * `source_name` -> `bodyHash`, for every lot entry that now carries a
   * statement. Read off the lots, so it says what the repository intends rather
   * than what the bank happens to hold.
   */
  readonly promotedHashBySourceName: ReadonlyMap<string, string>;
  /** Central-bank rows with no statement — a whole question baked into a PNG. */
  readonly imageRows: readonly RetirementCandidate[];
  /** Central-bank rows that DO carry a statement. */
  readonly textRows: readonly RetirementCandidate[];
}

/** One screenshot with no row of its own name, and the statement to find it by. */
export interface ImageTwinLookup {
  readonly sourceName: string;
  readonly bodyHash: string;
}

/**
 * Picks the screenshots whose lot promoted them to text but whose text row was
 * never inserted, and says which statement hash would find the row that took
 * their place.
 *
 * UNAC reuses items between its own exams, so restructuring a second lot writes
 * statements the bank already holds from the first. `seedLotQuestions` dedupes
 * those on `bodyHash` and inserts nothing — correctly, one question is one row —
 * but the second lot's screenshot is then left with no row carrying its
 * `source_name`, which is the only key `planImageQuestionRetirement` pairs on.
 * 44 questions were stuck there, still shown as pictures, and no number of
 * deploys would have cleared them.
 *
 * Kept separate from the retirement planner because it decides what to ASK the
 * database, not what to write: the shell turns this into one `IN` query, and in
 * the steady state the list comes back empty and that query never runs.
 */
export function planImageTwinLookup(input: PlanImageTwinLookupInput): readonly ImageTwinLookup[] {
  const namesWithOwnText = new Set<string>();
  for (const row of input.textRows) {
    if (row.sourceName) namesWithOwnText.add(row.sourceName);
  }

  const lookups: ImageTwinLookup[] = [];
  const seen = new Set<string>();
  for (const imageRow of input.imageRows) {
    if (!imageRow.sourceName || seen.has(imageRow.sourceName)) continue;
    if (namesWithOwnText.has(imageRow.sourceName)) continue;
    const bodyHash = input.promotedHashBySourceName.get(imageRow.sourceName);
    // No lot promoted this one, so it is a screenshot on purpose and there is
    // no statement anywhere to hand its exam slots to.
    if (!bodyHash) continue;
    seen.add(imageRow.sourceName);
    lookups.push({ sourceName: imageRow.sourceName, bodyHash });
  }
  return lookups;
}
