import { describe, it, expect, beforeEach } from 'vitest';
import { Difficulty } from '@exams-generator/shared';
import { ExamBuilderStore, buildCellKey } from './exam-builder.store';

describe('ExamBuilderStore', () => {
  let store: ExamBuilderStore;

  beforeEach(() => {
    store = new ExamBuilderStore();
  });

  it('starts with no grade level, no rows, and empty maps', () => {
    expect(store.gradeLevel()).toBeNull();
    expect(store.rows()).toEqual([]);
    expect(store.requested().size).toBe(0);
    expect(store.stock().size).toBe(0);
    expect(store.previewCache().size).toBe(0);
  });

  describe('rows', () => {
    it('addRow appends a content row; removeRow drops it by id', () => {
      store.addRow({ id: 'row-1', courseId: 'c1', courseName: 'Matemática', topicId: 't1', topicName: 'Álgebra' });
      expect(store.rows()).toHaveLength(1);

      store.removeRow('row-1');
      expect(store.rows()).toEqual([]);
    });
  });

  describe('cellStatus', () => {
    it('is "ok" when requested <= stock', () => {
      const key = buildCellKey('c1', 't1', Difficulty.Easy);
      store.setRequested(key, 6);
      store.setStockResults([{ courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 18 }]);

      expect(store.cellStatus(key)).toBe('ok');
    });

    it('is "short" when requested > stock', () => {
      const key = buildCellKey('c1', 't1', Difficulty.Easy);
      store.setRequested(key, 6);
      store.setStockResults([{ courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 2 }]);

      expect(store.cellStatus(key)).toBe('short');
    });

    it('treats a cell with no stock result yet as 0 available', () => {
      const key = buildCellKey('c1', 't1', Difficulty.Hard);
      store.setRequested(key, 1);

      expect(store.cellStatus(key)).toBe('short');
    });
  });

  describe('allSatisfiable', () => {
    it('is false when there are no requested cells (nothing to generate)', () => {
      expect(store.allSatisfiable()).toBe(false);
    });

    it('is false while any requested cell is short, true once all are satisfied', () => {
      const easy = buildCellKey('c1', 't1', Difficulty.Easy);
      const medium = buildCellKey('c1', 't1', Difficulty.Medium);
      store.setRequested(easy, 6);
      store.setRequested(medium, 4);
      store.setStockResults([
        { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 18 },
        { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Medium, available: 2 },
      ]);

      expect(store.allSatisfiable()).toBe(false);

      store.setRequested(medium, 2);

      expect(store.allSatisfiable()).toBe(true);
    });
  });

  describe('progress', () => {
    it('reports current (satisfied) vs total (requested) cell counts', () => {
      const easy = buildCellKey('c1', 't1', Difficulty.Easy);
      const medium = buildCellKey('c1', 't1', Difficulty.Medium);
      store.setRequested(easy, 6);
      store.setRequested(medium, 4);
      store.setStockResults([
        { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 18 },
        { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Medium, available: 2 },
      ]);

      expect(store.progress()).toEqual({ current: 1, total: 2 });
    });
  });

  describe('mergePreview (EB-R5 — critical)', () => {
    it('editing cell 2 and merging its B2 result leaves cell 1 cached questionIds byte-identical', () => {
      const cell1 = buildCellKey('c1', 't1', Difficulty.Easy);
      const cell2 = buildCellKey('c1', 't1', Difficulty.Medium);

      store.mergePreview(cell1, ['q1', 'q2', 'q3']);
      const cell1Before = store.previewCache().get(cell1);

      // simulate editing cell 2's requested count, then a B2 preview call resolving for cell 2 only
      store.setRequested(cell2, 4);
      store.mergePreview(cell2, ['q9', 'q10']);

      const cell1After = store.previewCache().get(cell1);
      expect(cell1After).toBe(cell1Before); // same array reference — never touched
      expect(cell1After).toEqual(['q1', 'q2', 'q3']);
      expect(store.previewCache().get(cell2)).toEqual(['q9', 'q10']);
    });
  });
});
