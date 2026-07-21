import { Injectable, computed, signal } from '@angular/core';
import { Difficulty } from '@exams-generator/shared';
import { GradeLevel, StockBatchCellResult } from '../exams.models';

/** `courseId:topicId:difficulty` — uniquely identifies one cell of the content table. */
export type CellKey = `${string}:${string}:${Difficulty}`;

export function buildCellKey(courseId: string, topicId: string, difficulty: Difficulty): CellKey {
  return `${courseId}:${topicId}:${difficulty}`;
}

/** One "pedido" row (curso·tema) of the content table (design doc §5.1). */
export interface ContentRow {
  readonly id: string;
  readonly courseId: string;
  readonly courseName: string;
  readonly topicId: string;
  readonly topicName: string;
}

export type CellStatus = 'ok' | 'short';

export interface BuilderProgress {
  readonly current: number;
  readonly total: number;
}

/**
 * One row resolved by `POST /exams/blueprint/resolve` (design doc §3.11),
 * with display names already looked up by the caller — same contract as
 * `ContentRow`/`addRow`, the store never fetches taxonomy data itself.
 * `topicId`/`topicName` are omitted for a whole-course row (`eta`/
 * `eta_by_week` when the template has no `syllabus_week_maps` data, e.g.
 * every UNCP row today) — `bulkLoadFromBlueprint` turns that into the
 * sentinel `topicId: ''` row (see its doc-comment).
 */
export interface ResolvedTemplateRow {
  readonly courseId: string;
  readonly courseName: string;
  readonly topicId?: string;
  readonly topicName?: string;
  readonly count: number;
  readonly difficulty?: Difficulty;
}

/**
 * A resolved template row with no source-level NIVEL to translate (UNI rows
 * only carry `weightPoints`/section, never P.B./P.I./P.A. — design doc
 * §3.6) resolves `difficulty` to `undefined` on the backend
 * (`resolveDifficultyFromSourceLevel`). `CellKey` requires a real
 * `Difficulty` segment, so `bulkLoadFromBlueprint` needs *some* column to
 * put the count in. `Medium` is chosen as the "no info" default — it's the
 * middle of the three columns rather than an extreme (`Easy`/`Hard`), so it
 * doesn't skew the totals row toward a difficulty tier the source data never
 * claimed. This is a display placement choice only; it never overwrites
 * `source_level`/anything persisted server-side (§3.6 keeps that lossless).
 */
const DEFAULT_TEMPLATE_DIFFICULTY = Difficulty.Medium;

/** Sentinel `topicId` for a whole-course resolved row — see `bulkLoadFromBlueprint`. */
const WHOLE_COURSE_TOPIC_ID = '';
const WHOLE_COURSE_TOPIC_NAME = 'Todos los temas';

/**
 * Screen-scoped signal store for the exam-builder master screen (DECISION
 * FE-5). Provided at the `ExamBuilderComponent` route level (NOT root) so
 * state resets on navigation away.
 *
 * Per-cell keying (`CellKey` = courseId:topicId:difficulty) is the
 * mechanism that makes "editing one cell never re-rolls another" (EB-R5)
 * structurally true: `mergePreview` only ever writes the ONE key it is
 * given — every other cell's cached `questionIds` array keeps its exact
 * prior reference (proven in exam-builder.store.spec.ts).
 */
@Injectable()
export class ExamBuilderStore {
  readonly gradeLevel = signal<GradeLevel | null>(null);
  readonly rows = signal<readonly ContentRow[]>([]);
  readonly requested = signal<ReadonlyMap<CellKey, number>>(new Map());
  readonly stock = signal<ReadonlyMap<CellKey, number>>(new Map());
  readonly previewCache = signal<ReadonlyMap<CellKey, readonly string[]>>(new Map());

  /** Cells the user has actually asked for (requested count > 0) — the ones that gate "Generar versiones". */
  readonly requestedCells = computed<readonly CellKey[]>(() =>
    Array.from(this.requested().entries())
      .filter(([, count]) => count > 0)
      .map(([key]) => key),
  );

  /** EB-R3/R4: locked until every requested cell has requested <= stock; false with zero requested cells (nothing to generate). */
  readonly allSatisfiable = computed<boolean>(() => {
    const cells = this.requestedCells();
    if (cells.length === 0) {
      return false;
    }
    return cells.every((key) => this.cellStatus(key) === 'ok');
  });

  /** Feeds the `ui/progress` footer bar (EB-R3): satisfied vs requested cell counts. */
  readonly progress = computed<BuilderProgress>(() => {
    const cells = this.requestedCells();
    const current = cells.filter((key) => this.cellStatus(key) === 'ok').length;
    return { current, total: cells.length };
  });

  /** Live per-difficulty column totals for the "Totales por nivel" row (design doc §5.1). */
  readonly totalsByDifficulty = computed<ReadonlyMap<Difficulty, number>>(() => {
    const totals = new Map<Difficulty, number>();
    for (const [key, count] of this.requested().entries()) {
      if (count <= 0) {
        continue;
      }
      const difficulty = key.split(':')[2] as Difficulty;
      totals.set(difficulty, (totals.get(difficulty) ?? 0) + count);
    }
    return totals;
  });

  /** Grand total requested across every cell — sums `totalsByDifficulty`. */
  readonly grandTotal = computed<number>(() =>
    Array.from(this.requested().values()).reduce((sum, count) => sum + Math.max(count, 0), 0),
  );

  /**
   * Also drops any already-populated `rows` when the grade level actually
   * CHANGES to a different value. Those rows were auto-populated for the OLD
   * grade's course·topic catalog (`ExamBuilderComponent.buildGrid` calls this
   * before re-fetching and re-`addRow`-ing for the new one) — left in place
   * they'd sit alongside the new grade's rows as stale, wrong-grade clutter,
   * and `addRow` has no id-dedup, so a same-id row would even violate the
   * `@for` template's `track row.id` uniqueness.
   *
   * A same-value call (re-selecting the grade level already active) is a
   * deliberate no-op here — it must never discard rows merged from elsewhere
   * for that same grade (e.g. a "Cargar plantilla" whole-course sentinel
   * row) just because the grid re-warms.
   *
   * This is what makes deriving the grade level from a non-manual "Tipo de
   * examen" selection (design doc §3.11) safe to implement by simply
   * reusing `buildGrid` — including the case where the user had already
   * picked a DIFFERENT grade level manually before switching exam type.
   */
  setGradeLevel(gradeLevel: GradeLevel | null): void {
    if (gradeLevel !== this.gradeLevel()) {
      this.rows.set([]);
    }
    this.gradeLevel.set(gradeLevel);
  }

  addRow(row: ContentRow): void {
    this.rows.update((current) => [...current, row]);
  }

  removeRow(rowId: string): void {
    this.rows.update((current) => current.filter((row) => row.id !== rowId));
  }

  /** requested <= stock => 'ok' (drives EB-R1's "de N" vs "solo N" warning-stock tag with a triangle-alert icon). */
  cellStatus(key: CellKey): CellStatus {
    const requestedCount = this.requested().get(key) ?? 0;
    const stockCount = this.stock().get(key) ?? 0;
    return requestedCount <= stockCount ? 'ok' : 'short';
  }

  setRequested(key: CellKey, count: number): void {
    this.requested.update((current) => {
      const next = new Map(current);
      next.set(key, count);
      return next;
    });
  }

  /**
   * Bulk-writes a B1 stock-batch response into the `stock` map, keyed per
   * cell. `POST /exams/stock/batch` echoes each request cell's `topicId`
   * back verbatim (order-matched) — for a whole-course cell, `loadStock()`
   * sends `topicId: undefined` (omitted), so `result.topicId` comes back
   * `undefined` too. That must map to the SAME sentinel `''` the rest of
   * this store uses for a whole-course row (`bulkLoadFromBlueprint`'s
   * `WHOLE_COURSE_TOPIC_ID`), not be discarded — `CellKey` requires a real
   * `string` segment, and a real cell's `stockFor()` lookup would otherwise
   * always miss and silently fall back to the "0 available" default,
   * exactly the "solo 0" symptom this fixes (design doc §3.11, Bug 3).
   * `difficulty` is still guarded defensively — this store's own requests
   * always specify one, but a malformed/foreign result should never key by
   * `undefined`.
   */
  setStockResults(results: readonly StockBatchCellResult[]): void {
    this.stock.update((current) => {
      const next = new Map(current);
      for (const result of results) {
        if (!result.difficulty) {
          continue;
        }
        const topicId = result.topicId ?? WHOLE_COURSE_TOPIC_ID;
        next.set(buildCellKey(result.courseId, topicId, result.difficulty), result.available);
      }
      return next;
    });
  }

  /**
   * Bulk-loads rows resolved by `POST /exams/blueprint/resolve` (design doc
   * §3.11) into the grid — the "Cargar plantilla" affordance on the
   * exam-builder screen. Never bypasses the normal mutation path: composes
   * `addRow`/`setRequested` exactly like a human filling the grid by hand
   * would, so the template is a starting point the user can still edit
   * afterward, not a separate locked state (design doc §1, "no son fuente de
   * verdad").
   *
   * A resolved row WITH a `topicId` reuses the existing `ContentRow` for
   * that course+topic when one is already present (the manual grid usually
   * already auto-populated every course·topic pair for the selected grade
   * level before the user clicks "Cargar plantilla") — never duplicates it —
   * and just sets the requested count on the matching difficulty cell.
   *
   * A resolved row with NO `topicId` (a whole-course row — happens for
   * `eta`/`eta_by_week` when the template's university/track has no
   * `syllabus_week_maps` data, e.g. every UNCP row today, since UNCP has no
   * public week-by-week syllabus) is represented as ONE `ContentRow` per
   * course using the sentinel `topicId: ''` + `topicName: 'Todos los
   * temas'` — `CellKey`'s template-literal type only requires a `string`
   * segment, so the empty string is a valid (if unusual) key piece. Several
   * resolved rows for the same whole course but different NIVEL/difficulty
   * (UNCP's P.B./P.I./P.A.) share that one sentinel row, one cell per
   * difficulty — exactly how a real multi-NIVEL course already renders in
   * the manual grid.
   *
   * **Critical round-trip**: `exam-builder.component.ts`'s
   * `onGenerateVersions()` MUST convert the sentinel `topicId: ''` back to
   * `topicId: undefined` (omitted) before POSTing to `/exams` — never send
   * a literal empty string, see that method's doc-comment.
   */
  bulkLoadFromBlueprint(rows: readonly ResolvedTemplateRow[]): void {
    for (const row of rows) {
      const topicId = row.topicId ?? WHOLE_COURSE_TOPIC_ID;
      const topicName = row.topicId ? (row.topicName ?? row.topicId) : WHOLE_COURSE_TOPIC_NAME;

      const alreadyPresent = this.rows().some((existing) => existing.courseId === row.courseId && existing.topicId === topicId);
      if (!alreadyPresent) {
        this.addRow({
          id: `${row.courseId}:${topicId}`,
          courseId: row.courseId,
          courseName: row.courseName,
          topicId,
          topicName,
        });
      }

      const difficulty = row.difficulty ?? DEFAULT_TEMPLATE_DIFFICULTY;
      this.setRequested(buildCellKey(row.courseId, topicId, difficulty), row.count);
    }
  }

  /**
   * Merges a single cell's B2 preview result into `previewCache`. Touches
   * ONLY `key` — every other cell's cached array keeps its exact prior
   * reference (EB-R5, B2-R5's client-cache mandate).
   */
  mergePreview(key: CellKey, questionIds: readonly string[]): void {
    this.previewCache.update((current) => {
      const next = new Map(current);
      next.set(key, questionIds);
      return next;
    });
  }
}
