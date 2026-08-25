import { describe, it, expect, beforeEach } from 'vitest';
import { Difficulty } from '@exams-generator/shared';
import { ExamBuilderStore, buildCellKey } from './exam-builder.store';

describe('ExamBuilderStore', () => {
  /**
   * Audit 2026-08-18: cargar una plantilla SUMABA sobre la anterior. Medido en
   * la app: UNCP Área II (80 preguntas) y luego UNI (100) dejaban un examen de
   * 153 preguntas en 26 celdas — una quimera que no corresponde a ninguna
   * universidad, con el botón de generar habilitado y sin ningún aviso.
   */
  it('clearRequested() deja el pedido vacío sin tocar el stock ya cargado', () => {
    const store = new ExamBuilderStore();
    store.setStockResults([
      { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 9 },
    ]);
    store.setRequested(buildCellKey('c1', 't1', Difficulty.Easy), 4);
    expect(store.grandTotal()).toBe(4);

    store.clearRequested();

    expect(store.grandTotal()).toBe(0);
    expect(store.requestedCells()).toHaveLength(0);
    expect(store.stock().get(buildCellKey('c1', 't1', Difficulty.Easy))).toBe(9);
  });

  it('una plantilla nueva REEMPLAZA a la anterior, no se suma encima', () => {
    const store = new ExamBuilderStore();
    store.bulkLoadFromBlueprint([
      { courseId: 'c1', courseName: 'Aritmética', count: 6, difficulty: Difficulty.Hard },
      { courseId: 'c9', courseName: 'Ecología', count: 3, difficulty: Difficulty.Medium },
    ]);
    expect(store.grandTotal()).toBe(9);

    // Otra universidad: comparte un curso, trae otro distinto.
    store.clearRequested();
    store.bulkLoadFromBlueprint([
      { courseId: 'c1', courseName: 'Aritmética', count: 8, difficulty: Difficulty.Medium },
    ]);

    expect(store.grandTotal()).toBe(8);
    expect(store.requestedCells()).toHaveLength(1);
  });

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
      store.addRow({
        id: 'row-1',
        courseId: 'c1',
        courseName: 'Matemática',
        topicId: 't1',
        topicName: 'Álgebra',
      });
      expect(store.rows()).toHaveLength(1);

      store.removeRow('row-1');
      expect(store.rows()).toEqual([]);
    });
  });

  describe('cellStatus', () => {
    it('is "ok" when requested <= stock', () => {
      const key = buildCellKey('c1', 't1', Difficulty.Easy);
      store.setRequested(key, 6);
      store.setStockResults([
        { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 18 },
      ]);

      expect(store.cellStatus(key)).toBe('ok');
    });

    it('is "short" when requested > stock', () => {
      const key = buildCellKey('c1', 't1', Difficulty.Easy);
      store.setRequested(key, 6);
      store.setStockResults([
        { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 2 },
      ]);

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

  describe('totalsByDifficulty / grandTotal', () => {
    it('sums requested counts per difficulty and a grand total across all cells, live as counts change', () => {
      const easy = buildCellKey('c1', 't1', Difficulty.Easy);
      const medium = buildCellKey('c1', 't1', Difficulty.Medium);
      const easyOtherTopic = buildCellKey('c2', 't2', Difficulty.Easy);

      store.setRequested(easy, 6);
      store.setRequested(medium, 3);
      store.setRequested(easyOtherTopic, 4);

      expect(store.totalsByDifficulty().get(Difficulty.Easy)).toBe(10);
      expect(store.totalsByDifficulty().get(Difficulty.Medium)).toBe(3);
      expect(store.totalsByDifficulty().get(Difficulty.Hard) ?? 0).toBe(0);
      expect(store.grandTotal()).toBe(13);

      store.setRequested(medium, 0);

      expect(store.totalsByDifficulty().get(Difficulty.Medium) ?? 0).toBe(0);
      expect(store.grandTotal()).toBe(10);
    });
  });

  describe('bulkLoadFromBlueprint (design doc §3.11 — template pre-fill)', () => {
    it('remembers each resolved row\'s layout, keyed by course and topic', () => {
      const store = new ExamBuilderStore();

      store.bulkLoadFromBlueprint([
        {
          courseId: 'c1',
          courseName: 'Aritmética',
          topicId: 't1',
          topicName: 'Conjuntos',
          count: 4,
          layout: {
            sortOrder: 2,
            blockCode: 'matematica',
            blockLabel: 'MATEMÁTICA',
            sectionCode: 'E2',
            sectionLabel: 'SEGUNDA PRUEBA',
          },
        },
      ]);

      expect(store.layoutFor('c1', 't1')?.sectionCode).toBe('E2');
      expect(store.layoutFor('c1', 't1')?.blockLabel).toBe('MATEMÁTICA');
      // A row nobody loaded from a template has none — the hand-added case.
      expect(store.layoutFor('c1', 'other')).toBeUndefined();
    });

    it('stores a whole-course row\'s layout under the sentinel topic id', () => {
      const store = new ExamBuilderStore();

      store.bulkLoadFromBlueprint([
        {
          courseId: 'c9',
          courseName: 'Física',
          count: 20,
          layout: { sortOrder: 0, sectionCode: 'E3', sectionLabel: 'TERCERA PRUEBA' },
        },
      ]);

      expect(store.layoutFor('c9', '')?.sectionCode).toBe('E3');
    });

    it('reuses an existing course+topic row and sets the requested count on the matching difficulty cell', () => {
      store.addRow({
        id: 'row-1',
        courseId: 'c1',
        courseName: 'Matemática',
        topicId: 't1',
        topicName: 'Álgebra',
      });

      store.bulkLoadFromBlueprint([
        {
          courseId: 'c1',
          courseName: 'Matemática',
          topicId: 't1',
          topicName: 'Álgebra',
          count: 8,
          difficulty: Difficulty.Hard,
        },
      ]);

      expect(store.rows()).toHaveLength(1); // reused, not duplicated
      const key = buildCellKey('c1', 't1', Difficulty.Hard);
      expect(store.requested().get(key)).toBe(8);
    });

    it('adds a new row when no matching course+topic row exists yet', () => {
      store.bulkLoadFromBlueprint([
        {
          courseId: 'c1',
          courseName: 'Matemática',
          topicId: 't1',
          topicName: 'Álgebra',
          count: 4,
          difficulty: Difficulty.Easy,
        },
      ]);

      expect(store.rows()).toHaveLength(1);
      expect(store.rows()[0]).toMatchObject({
        courseId: 'c1',
        topicId: 't1',
        topicName: 'Álgebra',
      });
      expect(store.requested().get(buildCellKey('c1', 't1', Difficulty.Easy))).toBe(4);
    });

    it('represents a whole-course resolved row (no topicId) with the sentinel topicId "" and topicName "Todos los temas"', () => {
      store.bulkLoadFromBlueprint([
        { courseId: 'c2', courseName: 'Física', count: 10, difficulty: Difficulty.Medium },
      ]);

      expect(store.rows()).toHaveLength(1);
      expect(store.rows()[0].topicId).toBe('');
      expect(store.rows()[0].topicName).toBe('Todos los temas');
      const key = buildCellKey('c2', '', Difficulty.Medium);
      expect(store.requested().get(key)).toBe(10);
    });

    it('reuses the same sentinel row across multiple difficulty rows of the same whole-course (e.g. UNCP NIVEL rows)', () => {
      store.bulkLoadFromBlueprint([
        { courseId: 'c2', courseName: 'Física', count: 6, difficulty: Difficulty.Easy },
        { courseId: 'c2', courseName: 'Física', count: 3, difficulty: Difficulty.Hard },
      ]);

      expect(store.rows()).toHaveLength(1); // one sentinel row for the course, not one per NIVEL
      expect(store.requested().get(buildCellKey('c2', '', Difficulty.Easy))).toBe(6);
      expect(store.requested().get(buildCellKey('c2', '', Difficulty.Hard))).toBe(3);
    });

    it('defaults an undefined resolved difficulty to Medium (documented default — UNI rows have no NIVEL to translate)', () => {
      store.bulkLoadFromBlueprint([
        { courseId: 'c1', courseName: 'Matemática', topicId: 't1', topicName: 'Álgebra', count: 7 },
      ]);

      expect(store.requested().get(buildCellKey('c1', 't1', Difficulty.Medium))).toBe(7);
    });
  });

  describe('setStockResults — whole-course sentinel round-trip (Bug 3)', () => {
    it('maps a result with topicId: undefined (echoed back from an omitted request field, meaning "whole course") to the sentinel "" CellKey instead of discarding it', () => {
      store.setStockResults([
        { courseId: 'c1', topicId: undefined, difficulty: Difficulty.Easy, available: 30 },
      ]);

      const key = buildCellKey('c1', '', Difficulty.Easy);
      expect(store.stock().get(key)).toBe(30);
    });

    it("still ignores a result with no difficulty (defensive — never sent by this store's own requests, which always specify one)", () => {
      store.setStockResults([
        { courseId: 'c1', topicId: 't1', difficulty: undefined, available: 30 },
      ]);

      expect(store.stock().size).toBe(0);
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
