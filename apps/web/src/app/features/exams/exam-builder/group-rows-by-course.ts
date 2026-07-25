import { ContentRow } from './exam-builder.store';

/** One course's contiguous run of `ContentRow`s — powers the course subheading grouping (design doc §5.1's "árbol"). */
export interface RowGroup {
  readonly courseId: string;
  readonly courseName: string;
  readonly rows: readonly ContentRow[];
}

/**
 * Groups rows by course, one `RowGroup` per distinct `courseId` no matter
 * where its rows sit in `store.rows()` — NOT a consecutive-run scan.
 *
 * `store.rows()` is course-then-topic ordered for the plain grade-level grid
 * (`loadTopicsAndStock`), but `ExamBuilderStore.bulkLoadFromBlueprint()`
 * (the "Cargar plantilla" feature) APPENDS resolved rows at the end via
 * `addRow` — including a whole-course "Todos los temas" sentinel row for a
 * course that may already have real topic rows earlier in the array from
 * the grid. That reintroduces the exact same `courseId` at a second,
 * non-consecutive position. A consecutive-run scan would then emit TWO
 * `RowGroup`s for that one course, which duplicates the `@for`'s
 * `track group.courseId` key (Angular NG0955) and renders the course twice
 * in the UI. Grouping by a `Map` keyed on `courseId` instead collects every
 * row for a course into a single group regardless of position.
 *
 * Group ORDER is still deterministic: a course's group is emitted in the
 * position of that course's FIRST row in `rows` (`Map` iteration order
 * follows insertion order), so the course a user sees first still appears
 * first in the grouped output.
 */
export function groupRowsByCourse(rows: readonly ContentRow[]): readonly RowGroup[] {
  const groupsByCourseId = new Map<string, { courseId: string; courseName: string; rows: ContentRow[] }>();
  for (const row of rows) {
    const existing = groupsByCourseId.get(row.courseId);
    if (existing) {
      existing.rows.push(row);
    } else {
      groupsByCourseId.set(row.courseId, { courseId: row.courseId, courseName: row.courseName, rows: [row] });
    }
  }
  return Array.from(groupsByCourseId.values());
}
