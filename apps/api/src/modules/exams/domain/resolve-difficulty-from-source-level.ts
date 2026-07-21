import { Difficulty } from "@exams-generator/shared";

/**
 * `exam_blueprint_template_rows.source_level` keeps the raw NIVEL string
 * (UNCP: "P.B."/"P.I."/"P.A.") exactly as the source table printed it — the
 * DB column is never lossily mapped to `Difficulty`, so a future
 * per-university calibration system still has the untouched signal (design
 * doc §3.6). This function is the ONLY place that translation happens, and
 * only transiently when building a resolver-time `BlueprintRow` — its output
 * is never written back to the DB.
 *
 * Unrecognized values (a future university's own vocabulary, or UNI rows
 * which have no NIVEL at all) degrade to `undefined` — "no difficulty
 * filter" — rather than throwing, matching how `BlueprintRow.difficulty` is
 * already optional in `blueprint-selector.ts`.
 */
const SOURCE_LEVEL_TO_DIFFICULTY: Readonly<Record<string, Difficulty>> = {
  "P.B.": Difficulty.Easy,
  "P.I.": Difficulty.Medium,
  "P.A.": Difficulty.Hard,
};

export function resolveDifficultyFromSourceLevel(
  sourceLevel: string | null | undefined,
): Difficulty | undefined {
  if (!sourceLevel) {
    return undefined;
  }
  return SOURCE_LEVEL_TO_DIFFICULTY[sourceLevel];
}
