/** One central-bank row, reduced to what pairing needs. */
export interface RetirementCandidate {
  readonly id: string;
  readonly sourceName: string | null;
}

export interface PlanImageQuestionRetirementInput {
  /** Central-bank rows with no statement — a whole question baked into a PNG. */
  readonly imageRows: readonly RetirementCandidate[];
  /** Central-bank rows that DO carry a statement. */
  readonly textRows: readonly RetirementCandidate[];
  /**
   * For a screenshot whose lot promoted it to text but whose text row was never
   * inserted: the row that already held that exact statement, keyed by the
   * screenshot's `source_name`.
   *
   * UNAC repeats items between its own exams, so restructuring a second lot
   * writes statements the bank already has from the first. The seeder dedupes
   * those on `bodyHash` and inserts nothing, which leaves the second lot's
   * screenshot with no row of its own name to hand over to — 44 questions were
   * stuck exactly there, unretirable by any number of deploys. The twin is the
   * row that statement DOES have, under the other lot's `source_name`.
   */
  readonly twinTextIdBySourceName?: ReadonlyMap<string, string>;
}

/** One screenshot to drop, and the text row that inherits its exam references. */
export interface RetirementPair {
  readonly imageId: string;
  readonly textId: string;
}

export interface ImageQuestionRetirementPlan {
  readonly retire: readonly RetirementPair[];
  /** Pairs left alone, with why — surfaced so a collision is never silent. */
  readonly skipped: readonly { sourceName: string; reason: string }[];
}

/**
 * Decides which whole-question screenshots the bank no longer needs.
 *
 * `restructure-image-lot.ts` promotes a harvested lot's PNGs to text, but
 * `seedLotQuestions` only INSERTS — image entries dedupe on `source_name`,
 * structured ones on `bodyHash`, and nothing retires the row the promotion
 * replaced. Without this pass the deploy that ships a restructured lot leaves
 * every one of its questions in the bank twice: once as the screenshot a
 * teacher cannot read, once as the text that superseded it.
 *
 * `source_name` is the join key because it is what identifies a question across
 * both shapes — the harvest fills it with exam, subject and question number,
 * and the restructure carries it over unchanged. It is deliberately NOT
 * `bodyHash`: an image row has none.
 */
export function planImageQuestionRetirement(
  input: PlanImageQuestionRetirementInput,
): ImageQuestionRetirementPlan {
  const textBySourceName = new Map<string, string[]>();
  for (const row of input.textRows) {
    if (!row.sourceName) continue;
    const ids = textBySourceName.get(row.sourceName);
    if (ids) {
      ids.push(row.id);
    } else {
      textBySourceName.set(row.sourceName, [row.id]);
    }
  }

  const retire: RetirementPair[] = [];
  const skipped: { sourceName: string; reason: string }[] = [];

  for (const imageRow of input.imageRows) {
    // A row with no provenance cannot be paired with anything, and guessing
    // from the statement is exactly the coin flip this module refuses.
    if (!imageRow.sourceName) continue;
    const textIds = textBySourceName.get(imageRow.sourceName);
    if (!textIds) {
      // No row of its own name. Its statement may still be in the bank under
      // the name of the lot that got there first, in which case the screenshot
      // is superseded just as thoroughly and its exam slots belong to that row.
      const twinId = input.twinTextIdBySourceName?.get(imageRow.sourceName);
      if (twinId) {
        retire.push({ imageId: imageRow.id, textId: twinId });
      }
      continue;
    }
    if (textIds.length > 1) {
      // The bank already holds a duplicate this pass did not create. Handing
      // the exam references to either one would bake a guess into an exam.
      skipped.push({
        sourceName: imageRow.sourceName,
        reason: `${textIds.length} filas de texto comparten este source_name`,
      });
      continue;
    }
    retire.push({ imageId: imageRow.id, textId: textIds[0] });
  }

  return { retire, skipped };
}
