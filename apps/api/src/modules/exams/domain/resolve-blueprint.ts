import { BlueprintRow } from "./blueprint-selector";
import { resolveDifficultyFromSourceLevel } from "./resolve-difficulty-from-source-level";

/** One row from `exam_blueprint_template_rows` (design doc §4) — course-level weight, never topic-scoped by itself. */
export interface TemplateRow {
  readonly courseId: string;
  readonly topicId?: string | null;
  readonly questionCount?: number | null;
  readonly weightPoints?: number | null;
  readonly sourceLevel?: string | null;
}

/** One row from `syllabus_week_maps` — only present for universities/tracks that have real week data (UNI today). */
export interface SyllabusEntry {
  readonly courseId: string;
  readonly topicId: string;
  readonly weekNumber: number;
}

export type CourseScope = "none" | "all" | "selected";
export type WeekScope = "none" | "current_only" | "cumulative";

export interface ResolveBlueprintOptions {
  readonly courseScope: CourseScope;
  readonly weekScope: WeekScope;
  readonly templateRows: readonly TemplateRow[];
  readonly syllabus: readonly SyllabusEntry[];
  /** Required whenever `weekScope !== 'none'`. */
  readonly currentWeek?: number;
  /** Required whenever `courseScope === 'selected'`. */
  readonly selectedCourseIds?: readonly string[];
  /**
   * Required whenever any in-scope row has no `questionCount` (UNI rows only
   * carry `weightPoints` — the official reglamento never published a
   * per-course question count, see design doc §3.5). Counts for those rows
   * are derived as an exact-sum proportional split of this total by weight.
   */
  readonly totalQuestionsOverride?: number;
}

/**
 * The single generic resolver behind every template-backed exam type
 * (`fastest`/`eta`/`eta_by_week` — `manual` never calls this). Reads
 * `course_scope`/`week_scope` off the exam type instead of branching per
 * type, so a future type that's a new combination of the same two axes is a
 * catalog insert, not new code (design doc §5).
 *
 * `eta_by_week` at an early week is NOT a smaller exam than the full ETA —
 * per product decision, a course's total question count stays constant
 * throughout the cycle; only WHICH topics it draws from narrows as fewer
 * weeks have been covered, so early weeks repeat topics more.
 */
export function resolveBlueprint(options: ResolveBlueprintOptions): BlueprintRow[] {
  const { courseScope, weekScope, templateRows, syllabus } = options;

  if (courseScope === "none") {
    return [];
  }

  const filteredRows =
    courseScope === "selected"
      ? templateRows.filter((row) => (options.selectedCourseIds ?? []).includes(row.courseId))
      : templateRows;

  const counts = resolveRowCounts(filteredRows, options.totalQuestionsOverride);

  if (weekScope === "none") {
    return filteredRows
      .map((row, index) => ({
        courseId: row.courseId,
        topicId: row.topicId ?? undefined,
        count: counts[index],
        difficulty: resolveDifficultyFromSourceLevel(row.sourceLevel),
      }))
      .filter((row) => row.count > 0);
  }

  const currentWeek = options.currentWeek ?? 0;
  const result: BlueprintRow[] = [];

  filteredRows.forEach((row, index) => {
    const topicsInScope = syllabus
      .filter((entry) => entry.courseId === row.courseId)
      .filter((entry) =>
        weekScope === "current_only" ? entry.weekNumber === currentWeek : entry.weekNumber <= currentWeek,
      );

    if (topicsInScope.length === 0) {
      return; // no syllabus data in scope for this course (e.g. UNCP has none) — drop it, don't fabricate a row
    }

    const perTopicCounts = distributeEvenly(counts[index], topicsInScope.length);
    const difficulty = resolveDifficultyFromSourceLevel(row.sourceLevel);

    topicsInScope.forEach((topic, topicIndex) => {
      const count = perTopicCounts[topicIndex];
      if (count > 0) {
        result.push({ courseId: row.courseId, topicId: topic.topicId, count, difficulty });
      }
    });
  });

  return result;
}

/** Resolves each row's total count — direct `questionCount` when known, else an exact-sum share of `totalQuestionsOverride` by `weightPoints`. */
function resolveRowCounts(rows: readonly TemplateRow[], totalQuestionsOverride: number | undefined): number[] {
  const counts = new Array<number>(rows.length).fill(0);
  const unknownIndexes: number[] = [];

  rows.forEach((row, index) => {
    if (row.questionCount !== undefined && row.questionCount !== null) {
      counts[index] = row.questionCount;
    } else {
      unknownIndexes.push(index);
    }
  });

  if (unknownIndexes.length > 0 && totalQuestionsOverride !== undefined) {
    const totalWeight = unknownIndexes.reduce((sum, index) => sum + (rows[index].weightPoints ?? 0), 0);
    const shares = unknownIndexes.map((index) =>
      totalWeight > 0 ? (rows[index].weightPoints ?? 0) / totalWeight : 1 / unknownIndexes.length,
    );
    const derived = distributeByShare(totalQuestionsOverride, shares);
    unknownIndexes.forEach((index, i) => {
      counts[index] = derived[i];
    });
  }

  return counts;
}

function distributeEvenly(total: number, n: number): number[] {
  if (n === 0) {
    return [];
  }
  return distributeByShare(total, new Array<number>(n).fill(1 / n));
}

/** Largest-remainder allocation — guarantees `sum(result) === total` exactly, unlike naive per-entry rounding which can drift. */
function distributeByShare(total: number, shares: readonly number[]): number[] {
  const raw = shares.map((share) => share * total);
  const base = raw.map((value) => Math.floor(value));
  let remainder = total - base.reduce((sum, value) => sum + value, 0);

  const byFractionDesc = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  const result = [...base];
  for (let i = 0; i < byFractionDesc.length && remainder > 0; i += 1) {
    result[byFractionDesc[i].index] += 1;
    remainder -= 1;
  }
  return result;
}
