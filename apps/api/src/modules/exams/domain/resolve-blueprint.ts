import { BlueprintRow } from "./blueprint-selector";
import { resolveDifficultyFromSourceLevel } from "./resolve-difficulty-from-source-level";

/** One row from `exam_blueprint_template_rows` (design doc §4) — course-level weight, never topic-scoped by itself. */
export interface TemplateRow {
  readonly courseId: string;
  readonly topicId?: string | null;
  readonly questionCount?: number | null;
  readonly weightPoints?: number | null;
  readonly sourceLevel?: string | null;
  readonly sortOrder?: number | null;
  readonly blockCode?: string | null;
  readonly blockLabel?: string | null;
  readonly sectionCode?: string | null;
  readonly sectionLabel?: string | null;
  /**
   * The block's OFFICIAL total, as the university publishes it — 40 questions
   * of Mathematics, say. Our per-course split has to add up to it; when it
   * doesn't, `blockCountMismatches` reports the discrepancy.
   */
  readonly blockQuestionCount?: number | null;
}

/** One row from `syllabus_week_maps` — only present for universities/tracks that have real week data (UNI today). */
export interface SyllabusEntry {
  readonly courseId: string;
  readonly topicId: string;
  readonly weekNumber: number;
}

/**
 * One (course, topic) pair from the tenant-visible topic catalog — the whole
 * catalog for the course, NOT a week-scoped slice (that is `SyllabusEntry`).
 *
 * Supplied only for `weekScope: 'none'` templates, which are exactly the ones
 * that have no syllabus to expand by: without this the resolver emits a single
 * whole-course row and the teacher lands on "Todos los temas" with no per-topic
 * breakdown to adjust. With it, each course's count is pre-selected across its
 * own topics, matching the per-topic shape the week-scoped types already
 * produce.
 */
export interface CourseTopic {
  readonly courseId: string;
  readonly topicId: string;
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
  /**
   * The full topic catalog for the courses in scope. Optional: omitted (or
   * empty for a given course) keeps the pre-existing whole-course row for that
   * course, so a template referencing a course with no topics loaded degrades
   * exactly as it did before instead of vanishing.
   */
  readonly courseTopics?: readonly CourseTopic[];
}

/**
 * Result of {@link resolveBlueprint}. `usedCumulativeFallback` is exposed
 * separately from `rows` so a caller (`exams.service.ts`) can tell the
 * difference between "current_only honored the exact current week" and
 * "current_only silently widened to cumulative because the syllabus doesn't
 * reach that far" — the P0 fix (docs/audit-2026-08-14.md, 2026-08-14):
 * "Rápido (semana actual)" used to return an empty exam once the
 * calendar-computed week ran past the last week the syllabus has data for.
 * Product decision: widen to "everything seen so far" instead of erroring or
 * emitting nothing — but the teacher asked for "current week" and got
 * something else, so the caller MUST surface that, not swallow it.
 */
export interface ResolveBlueprintOutcome {
  readonly rows: BlueprintRow[];
  /**
   * True when `weekScope === 'current_only'` and at least one in-scope row
   * had no syllabus entry at exactly `currentWeek` but DID have earlier
   * entries, so it was widened to `weekNumber <= currentWeek` (the same rule
   * `cumulative` already uses) instead of being silently dropped. Always
   * `false` for `weekScope !== 'current_only'` — `cumulative` is the type's
   * normal behavior, never a degraded fallback.
   */
  readonly usedCumulativeFallback: boolean;
  /**
   * Blocks whose per-course split does not add up to the total the university
   * published. Reported, never silently corrected — same principle as
   * `usedCumulativeFallback` above: the total is official data and the split
   * is ours, so a discrepancy is a template error somebody has to see
   * (design doc §3.9, §5.1).
   */
  readonly blockCountMismatches: readonly BlockCountMismatch[];
}

/**
 * A block whose per-course split does not sum to the university's published
 * total for it.
 */
export interface BlockCountMismatch {
  readonly blockCode: string;
  readonly blockLabel: string | null;
  readonly expected: number;
  readonly actual: number;
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
export function resolveBlueprint(options: ResolveBlueprintOptions): ResolveBlueprintOutcome {
  const { courseScope, weekScope, templateRows, syllabus } = options;

  if (courseScope === "none") {
    return { rows: [], usedCumulativeFallback: false, blockCountMismatches: [] };
  }

  const filteredRows =
    courseScope === "selected"
      ? templateRows.filter((row) => (options.selectedCourseIds ?? []).includes(row.courseId))
      : templateRows;

  const counts = resolveRowCounts(filteredRows, options.totalQuestionsOverride);
  const blockCountMismatches = findBlockCountMismatches(filteredRows);

  if (weekScope === "none") {
    const rows: BlueprintRow[] = [];

    filteredRows.forEach((row, index) => {
      const count = counts[index];
      if (count <= 0) {
        return;
      }
      const difficulty = resolveDifficultyFromSourceLevel(row.sourceLevel);

      // A row that names its own topic is already as specific as it gets —
      // expanding it would contradict the template.
      if (row.topicId) {
        rows.push({
          courseId: row.courseId,
          topicId: row.topicId,
          count,
          difficulty,
          ...layoutOf(row, index),
        });
        return;
      }

      const topics = (options.courseTopics ?? []).filter((topic) => topic.courseId === row.courseId);
      if (topics.length === 0) {
        rows.push({ courseId: row.courseId, topicId: undefined, count, difficulty, ...layoutOf(row, index) });
        return;
      }

      const perTopicCounts = distributeEvenly(count, topics.length);
      topics.forEach((topic, topicIndex) => {
        const topicCount = perTopicCounts[topicIndex];
        if (topicCount > 0) {
          rows.push({
            courseId: row.courseId,
            topicId: topic.topicId,
            count: topicCount,
            difficulty,
            ...layoutOf(row, index),
          });
        }
      });
    });

    return { rows, usedCumulativeFallback: false, blockCountMismatches };
  }

  const currentWeek = options.currentWeek ?? 0;
  const result: BlueprintRow[] = [];
  let usedCumulativeFallback = false;

  filteredRows.forEach((row, index) => {
    const courseSyllabus = syllabus.filter((entry) => entry.courseId === row.courseId);

    let topicsInScope: readonly SyllabusEntry[];
    if (weekScope === "current_only") {
      const exactWeek = courseSyllabus.filter((entry) => entry.weekNumber === currentWeek);
      if (exactWeek.length > 0) {
        topicsInScope = exactWeek;
      } else {
        // The calendar-computed current week has no syllabus entry for this
        // course. Widen to "everything seen so far" (same rule as
        // `cumulative`) rather than fabricating nothing — but only when
        // there IS earlier data to widen into; a course with zero syllabus
        // at all (e.g. UNCP) still gets dropped, unchanged.
        const upToCurrentWeek = courseSyllabus.filter((entry) => entry.weekNumber <= currentWeek);
        if (upToCurrentWeek.length > 0) {
          topicsInScope = upToCurrentWeek;
          usedCumulativeFallback = true;
        } else {
          topicsInScope = [];
        }
      }
    } else {
      topicsInScope = courseSyllabus.filter((entry) => entry.weekNumber <= currentWeek);
    }

    if (topicsInScope.length === 0) {
      return; // no syllabus data in scope for this course (e.g. UNCP has none) — drop it, don't fabricate a row
    }

    const perTopicCounts = distributeEvenly(counts[index], topicsInScope.length);
    const difficulty = resolveDifficultyFromSourceLevel(row.sourceLevel);

    topicsInScope.forEach((topic, topicIndex) => {
      const count = perTopicCounts[topicIndex];
      if (count > 0) {
        result.push({
          courseId: row.courseId,
          topicId: topic.topicId,
          count,
          difficulty,
          ...layoutOf(row, index),
        });
      }
    });
  });

  return { rows: result, usedCumulativeFallback, blockCountMismatches };
}

/**
 * A template row's layout metadata. When the template carries none — a source
 * that only publishes weights — `sortOrder` falls back to the row's index:
 * with no explicit order, the source's own order is the best signal there is.
 */
function layoutOf(row: TemplateRow, index: number) {
  return {
    sortOrder: row.sortOrder ?? index,
    blockCode: row.blockCode ?? null,
    blockLabel: row.blockLabel ?? null,
    sectionCode: row.sectionCode ?? null,
    sectionLabel: row.sectionLabel ?? null,
  };
}

/**
 * Compares, per block, the published official total against the sum of the
 * per-course split. Only looks at blocks that declare a total: with nothing
 * published there is nothing to compare against.
 */
function findBlockCountMismatches(rows: readonly TemplateRow[]): BlockCountMismatch[] {
  const byBlock = new Map<string, { blockLabel: string | null; expected: number; actual: number }>();

  for (const row of rows) {
    if (!row.blockCode || row.blockQuestionCount == null) {
      continue;
    }
    const entry = byBlock.get(row.blockCode) ?? {
      blockLabel: row.blockLabel ?? null,
      expected: row.blockQuestionCount,
      actual: 0,
    };
    entry.actual += row.questionCount ?? 0;
    byBlock.set(row.blockCode, entry);
  }

  return [...byBlock.entries()]
    .filter(([, entry]) => entry.actual !== entry.expected)
    .map(([blockCode, entry]) => ({
      blockCode,
      blockLabel: entry.blockLabel,
      expected: entry.expected,
      actual: entry.actual,
    }));
}

/** Resolves each row's total count — direct `questionCount` when known, else an exact-sum share of `totalQuestionsOverride` by `weightPoints`. */
function resolveRowCounts(
  rows: readonly TemplateRow[],
  totalQuestionsOverride: number | undefined,
): number[] {
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
