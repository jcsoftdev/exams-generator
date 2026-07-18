import { Difficulty } from "@exams-generator/shared";
import { Rng, shuffleArray } from "./ports/random.port";

/**
 * A question available to be picked into an exam.
 *
 * NOTE: the pool handed to `select()` is ALREADY filtered upstream by the
 * repository layer — tenant visibility (`tenant_id IS NULL OR = current`),
 * `status = 'approved'`, and the exam's `gradeLevel`. This domain function
 * only matches blueprint-row criteria against whatever pool it receives; it
 * has no knowledge of tenants, approval status, or grade level.
 */
export interface Candidate {
  readonly id: string;
  readonly courseId: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
}

/** One blueprint row: "N questions of {course, topic?, difficulty?}". */
export interface BlueprintRow {
  readonly courseId: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly count: number;
}

export interface RowShortage {
  readonly row: BlueprintRow;
  readonly available: number;
}

export type SelectionResult =
  | { ok: true; questionIds: string[] }
  | { ok: false; shortages: RowShortage[] };

/**
 * Selects distinct questions from `pool` to satisfy every row in `rows`.
 *
 * Rules:
 * - Rows are processed in the given order; once a candidate is used to fill
 *   a row, it is removed from contention for every later row (no reuse
 *   across rows), even when rows share the same matching criteria.
 * - A row that cannot find `count` distinct unused matching candidates is
 *   reported as a shortage — it does NOT consume any candidates, and
 *   processing continues so ALL shortages can be reported at once.
 * - If any row is short, the whole selection fails (`ok: false`) with the
 *   full list of shortages. Otherwise `ok: true` with every selected id.
 */
export function select(
  rows: readonly BlueprintRow[],
  pool: readonly Candidate[],
  rng: Rng,
): SelectionResult {
  const used = new Set<string>();
  const shortages: RowShortage[] = [];
  const selectedIdsByRow: string[][] = [];

  for (const row of rows) {
    const matching = pool.filter(
      (candidate) => matchesRow(candidate, row) && !used.has(candidate.id),
    );

    if (matching.length < row.count) {
      shortages.push({ row, available: matching.length });
      selectedIdsByRow.push([]);
      continue;
    }

    const chosen = shuffleArray(matching, rng)
      .slice(0, row.count)
      .map((candidate) => candidate.id);
    chosen.forEach((id) => used.add(id));
    selectedIdsByRow.push(chosen);
  }

  if (shortages.length > 0) {
    return { ok: false, shortages };
  }

  return { ok: true, questionIds: selectedIdsByRow.flat() };
}

function matchesRow(candidate: Candidate, row: BlueprintRow): boolean {
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
