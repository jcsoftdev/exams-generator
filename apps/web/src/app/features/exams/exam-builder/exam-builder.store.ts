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

  setGradeLevel(gradeLevel: GradeLevel | null): void {
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

  /** Bulk-writes a B1 stock-batch response into the `stock` map, keyed per cell. */
  setStockResults(results: readonly StockBatchCellResult[]): void {
    this.stock.update((current) => {
      const next = new Map(current);
      for (const result of results) {
        if (!result.topicId || !result.difficulty) {
          continue;
        }
        next.set(buildCellKey(result.courseId, result.topicId, result.difficulty), result.available);
      }
      return next;
    });
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
