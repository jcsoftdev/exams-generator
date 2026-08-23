import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { Difficulty } from '@exams-generator/shared';
import { GRADE_LEVEL_LABELS, GradeLevel } from '../exams.models';
import {
  BUILDER_STATE_KEY,
  ExamBuilderComponent,
  PREVIEW_DEBOUNCE_MS,
  TEMPLATE_RELOAD_DEBOUNCE_MS,
  toApiTopicId,
  toCreateExamBlueprintRow,
} from './exam-builder.component';
import { buildCellKey } from './exam-builder.store';
import { ExamsService } from '../exams.service';
import { ExamVersionsService } from '../../exam-versions/exam-versions.service';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import {
  StockBatchResult,
  PreviewExamResult,
  CreateExamResult,
  ExamType,
  University,
  Track,
  ResolveBlueprintPayload,
  ResolveBlueprintResult,
} from '../exams.models';
import { ExamVersionJob } from '../../exam-versions/exam-versions.models';

const COURSES: Course[] = [{ id: 'c1', name: 'Matemática', stage: 'preuniversitario' }];
const TOPICS: Topic[] = [{ id: 't1', name: 'Álgebra', courseId: 'c1' }];

const FULL_STOCK: StockBatchResult = {
  results: [
    { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 18 },
    { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Medium, available: 18 },
    { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Hard, available: 18 },
  ],
};

const ZERO_STOCK: StockBatchResult = {
  results: [
    { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 0 },
    { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Medium, available: 0 },
    { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Hard, available: 0 },
  ],
};

const MIXED_STOCK: StockBatchResult = {
  results: [
    { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 18 },
    { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Medium, available: 0 },
    { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Hard, available: 18 },
  ],
};

/** "Tipo de examen" catalog (design doc §5) — same 4 seeded rows as the backend. */
const EXAM_TYPES: ExamType[] = [
  { code: 'manual', label: 'Manual', courseScope: 'none', weekScope: 'none' },
  { code: 'fastest', label: 'Fastest', courseScope: 'selected', weekScope: 'current_only' },
  { code: 'eta', label: 'ETA', courseScope: 'all', weekScope: 'none' },
  { code: 'eta_by_week', label: 'ETA por semana', courseScope: 'all', weekScope: 'cumulative' },
];
const UNIVERSITIES: University[] = [{ id: 'u1', code: 'uni', name: 'UNI' }];
const TRACKS: Track[] = [
  { id: 'trk1', code: 'preuniversitario', name: 'Preuniversitario', kind: 'cycle_track' },
];

function setup(
  overrides: {
    getCourses?(): unknown;
    getTopicsForCourses?(courseIds: string[], gradeLevel?: string): unknown;
    stockBatch?(payload: unknown): unknown;
    previewExam?(payload: unknown): unknown;
    createExam?(payload: unknown): unknown;
    generateVersions?(...args: unknown[]): unknown;
    getExamTypes?(): unknown;
    getUniversities?(): unknown;
    getUniversityTracks?(universityId: string): unknown;
    resolveBlueprint?(payload: unknown): unknown;
    gradeLevelStock?(): unknown;
  } = {},
) {
  const getCourses = vi.fn(overrides.getCourses ?? (() => of(COURSES)));
  const getTopicsForCourses = vi.fn(overrides.getTopicsForCourses ?? (() => of(TOPICS)));
  const stockBatch = vi.fn(overrides.stockBatch ?? (() => of(FULL_STOCK)));
  const previewExam = vi.fn(
    overrides.previewExam ??
      ((payload: { blueprint: { count: number }[] }) =>
        of<PreviewExamResult>({
          selections: [
            {
              rowIndex: 0,
              courseId: 'c1',
              topicId: 't1',
              difficulty: Difficulty.Easy,
              questionIds: Array.from({ length: payload.blueprint[0].count }, (_, i) => `q${i}`),
            },
          ],
          shortages: [],
        })),
  );
  const createExam = vi.fn(
    overrides.createExam ??
      (() => of<CreateExamResult>({ id: 'exam-1', status: 'draft', selectedQuestionIds: [] })),
  );
  const generateVersions = vi.fn(
    overrides.generateVersions ??
      (() =>
        of<ExamVersionJob>({
          id: 'version-job-1',
          examId: 'exam-1',
          versionCount: 2,
          status: 'pending',
          completedCount: 0,
          failedReason: null,
          failedQuestionId: null,
        })),
  );
  const getExamTypes = vi.fn(overrides.getExamTypes ?? (() => of(EXAM_TYPES)));
  const getUniversities = vi.fn(overrides.getUniversities ?? (() => of(UNIVERSITIES)));
  const getUniversityTracks = vi.fn(overrides.getUniversityTracks ?? (() => of<Track[]>([])));
  const resolveBlueprint = vi.fn(
    overrides.resolveBlueprint ??
      (() => of<ResolveBlueprintResult>({ blueprint: [], weekNumber: null, templateId: null })),
  );
  // Default: the stock endpoint answers "nothing known" (empty catalog) so the
  // Grado labels stay exactly as they were for every pre-existing test — the
  // suffix is opt-in per test via `gradeLevelStock`.
  const gradeLevelStock = vi.fn(overrides.gradeLevelStock ?? (() => of({ results: [] })));
  const navigate = vi.fn();

  TestBed.configureTestingModule({
    imports: [ExamBuilderComponent],
    providers: [
      { provide: TaxonomyService, useValue: { getCourses, getTopicsForCourses } },
      {
        provide: ExamsService,
        useValue: {
          stockBatch,
          previewExam,
          createExam,
          getExamTypes,
          getUniversities,
          getUniversityTracks,
          resolveBlueprint,
          gradeLevelStock,
        },
      },
      { provide: ExamVersionsService, useValue: { generateVersions } },
      { provide: Router, useValue: { navigate } },
    ],
  });

  const fixture = TestBed.createComponent(ExamBuilderComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  return {
    fixture,
    compiled,
    getCourses,
    getTopicsForCourses,
    stockBatch,
    previewExam,
    createExam,
    generateVersions,
    getExamTypes,
    getUniversities,
    getUniversityTracks,
    resolveBlueprint,
    navigate,
  };
}

/**
 * Opens a `ui-select` identified by its `data-testid` and clicks the option
 * whose label matches. Matches by PREFIX: the Grado options carry an
 * availability suffix ("5° secundaria · 12 preguntas", audit 2026-08-15), and
 * every caller here names the grade, not its stock.
 */
function selectFromUiSelect(
  compiled: HTMLElement,
  fixture: { detectChanges: () => void },
  testId: string,
  optionLabel: string,
): void {
  const container = compiled.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
  if (!container) {
    throw new Error(`ui-select with data-testid="${testId}" not found`);
  }
  (container.querySelector('button[role="combobox"]') as HTMLButtonElement).click();
  fixture.detectChanges();
  const option = Array.from(container.querySelectorAll('[data-testid="select-option"]')).find(
    (li) =>
      li.textContent?.trim() === optionLabel ||
      li.textContent?.trim().startsWith(`${optionLabel} ·`),
  ) as HTMLElement | undefined;
  if (!option) {
    throw new Error(`option "${optionLabel}" not found in ui-select "${testId}"`);
  }
  option.click();
  fixture.detectChanges();
}

/**
 * Opens the folded grid for a guided exam type. A template-driven flow now
 * lands on the receipt + the action, with the 80-cell grid one click away —
 * every test that asserts on a CELL has to ask for the cells first. No-op for
 * manual (nothing to unfold) and for an already-open grid (a shortage forces
 * it open).
 */
function openGrid(compiled: HTMLElement, fixture: { detectChanges: () => void }): void {
  if (compiled.querySelector('[data-testid="content-table-desktop"]')) {
    return; // ya abierta — el disparador es un toggle, un segundo click la cerraría
  }
  const disclosure = compiled.querySelector<HTMLButtonElement>(
    '[data-testid="grid-disclosure"] button',
  );
  if (disclosure) {
    disclosure.click();
    fixture.detectChanges();
  }
}

function selectGradeLevel(
  compiled: HTMLElement,
  fixture: { detectChanges: () => void },
  value: GradeLevel,
): void {
  selectFromUiSelect(compiled, fixture, 'grade-level-select', GRADE_LEVEL_LABELS[value]);
}

/** Opens the Grado select and returns its option labels verbatim (suffixes included). */
function openAndReadGradeOptions(
  compiled: HTMLElement,
  fixture: { detectChanges: () => void },
): string[] {
  const container = compiled.querySelector('[data-testid="grade-level-select"]') as HTMLElement;
  (container.querySelector('button[role="combobox"]') as HTMLButtonElement).click();
  fixture.detectChanges();
  return Array.from(container.querySelectorAll('[data-testid="select-option"]')).map(
    (li) => li.textContent?.trim() ?? '',
  );
}

function setCellCount(
  compiled: HTMLElement,
  fixture: { detectChanges: () => void },
  cellKey: string,
  value: string,
): void {
  const input = compiled.querySelector<HTMLInputElement>(`input[name="requested-${cellKey}"]`);
  if (!input) {
    throw new Error(`input for cell ${cellKey} not found`);
  }
  input.value = value;
  input.dispatchEvent(new Event('input'));
  // The preview call is debounced per cell (see PREVIEW_DEBOUNCE_MS) — every
  // existing assertion about `previewExam` was written against the old
  // fire-on-every-keystroke behaviour, so the shared helper flushes the
  // debounce window instead of each test having to know about it. `type()`
  // below is the helper for tests that care about the debounce itself.
  vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
  fixture.detectChanges();
}

/**
 * Types `value` one character at a time WITHOUT flushing the debounce between
 * keystrokes — the real browser behaviour `setCellCount` deliberately hides.
 */
function typeCellCount(
  compiled: HTMLElement,
  fixture: { detectChanges: () => void },
  cellKey: string,
  value: string,
): void {
  const input = compiled.querySelector<HTMLInputElement>(`input[name="requested-${cellKey}"]`);
  if (!input) {
    throw new Error(`input for cell ${cellKey} not found`);
  }
  for (let i = 1; i <= value.length; i += 1) {
    input.value = value.slice(0, i);
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
}

/** Types into the optional "Cantidad total de preguntas" field (`totalQuestionsOverride`). */
function setTotalQuestionsOverride(
  compiled: HTMLElement,
  fixture: { detectChanges: () => void },
  value: string,
): void {
  const input = compiled.querySelector<HTMLInputElement>('input[name="total-questions-override"]');
  if (!input) {
    throw new Error('input for total-questions-override not found');
  }
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

describe('ExamBuilderComponent', () => {
  // Fake timers for the whole file: the per-cell preview debounce is the only
  // timer this component uses, and `setCellCount` flushes it so every
  // pre-existing test keeps its original fire-and-assert shape.
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  /**
   * Audit 2026-08-15, reproducido: con 2 celdas llenas (total 24) tocar
   * "Generar N con IA" navegaba fuera, y al volver con Atrás el grado estaba
   * en "Selecciona un grado", la grilla vacía y 0 inputs con valor. El store
   * es component-scoped a propósito (resetea al navegar), así que el estado
   * tiene que sobrevivir FUERA del componente.
   */
  describe('no perder el trabajo al salir de la pantalla', () => {
    it('guarda grado y cantidades pedidas apenas se edita una celda', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');

      const saved = JSON.parse(sessionStorage.getItem(BUILDER_STATE_KEY)!);
      expect(saved.gradeLevel).toBe('secundaria_1');
      expect(saved.requested).toEqual([['c1:t1:easy', 6]]);
    });

    it('restaura grado y cantidades al volver a montar la pantalla', () => {
      sessionStorage.setItem(
        BUILDER_STATE_KEY,
        JSON.stringify({
          examTypeCode: 'manual',
          gradeLevel: 'secundaria_1',
          universityId: null,
          trackId: null,
          selectedCourseIds: [],
          totalQuestions: '',
          requested: [['c1:t1:easy', 6]],
        }),
      );

      const { compiled } = setup();

      const gradeTrigger = compiled.querySelector(
        '[data-testid="grade-level-select"] [role="combobox"]',
      )!;
      expect(gradeTrigger.textContent).toContain(GRADE_LEVEL_LABELS['secundaria_1']);
      const input = compiled.querySelector<HTMLInputElement>('input[name="requested-c1:t1:easy"]')!;
      expect(input.value).toBe('6');
      expect(compiled.querySelector('[data-testid="grand-total"]')!.textContent).toContain('6');
    });

    it('no restaura nada cuando no hay estado guardado (pantalla en blanco, como siempre)', () => {
      const { compiled } = setup();

      const gradeTrigger = compiled.querySelector(
        '[data-testid="grade-level-select"] [role="combobox"]',
      )!;
      expect(gradeTrigger.textContent).toContain('Selecciona un grado');
      expect(compiled.querySelector('[data-testid="builder-row"]')).toBeFalsy();
    });

    it('descarta un estado guardado corrupto en vez de romper la pantalla', () => {
      sessionStorage.setItem(BUILDER_STATE_KEY, '{no es json');

      const { compiled } = setup();

      expect(compiled.querySelector('[data-testid="exam-builder"]')).toBeTruthy();
      expect(sessionStorage.getItem(BUILDER_STATE_KEY)).toBeNull();
    });

    it('olvida el estado una vez que el examen se generó', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');
      expect(sessionStorage.getItem(BUILDER_STATE_KEY)).not.toBeNull();

      compiled
        .querySelector<HTMLButtonElement>('[data-testid="generate-versions"] button')!
        .click();
      fixture.detectChanges();

      expect(sessionStorage.getItem(BUILDER_STATE_KEY)).toBeNull();
    });
  });

  describe('loading', () => {
    it('shows a loading indicator while the stock-batch call is pending and renders no stale data', () => {
      const stockSubject = new Subject<StockBatchResult>();
      const { compiled, fixture } = setup({ stockBatch: () => stockSubject.asObservable() });

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeFalsy();

      stockSubject.next(FULL_STOCK);
      stockSubject.complete();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeTruthy();
    });
  });

  describe('empty', () => {
    it('renders the empty state with both CTAs when there is zero stock for the grade level', () => {
      const { compiled, fixture } = setup({ stockBatch: () => of(ZERO_STOCK) });

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      const emptyState = compiled.querySelector('[data-testid="empty-state-cta"]');
      expect(emptyState).toBeTruthy();
      expect(emptyState!.textContent).toContain('Subir preguntas');
      expect(emptyState!.textContent).toContain('Generar con IA');
      expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeFalsy();
    });

    it('renders the empty state when the course catalog is empty', () => {
      const { compiled, fixture } = setup({ getCourses: () => of([]) });

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      expect(compiled.querySelector('[data-testid="empty-state-cta"]')).toBeTruthy();
    });
  });

  describe('error', () => {
    it('renders an error state distinguishable from loading/empty when the stock-batch call fails', () => {
      const { compiled, fixture } = setup({
        stockBatch: () => throwError(() => new Error('boom')),
      });

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      const errorState = compiled.querySelector('[data-testid="error-state"]');
      expect(errorState).toBeTruthy();
      expect(errorState!.textContent).toMatch(/no se pudieron cargar/i);
      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="empty-state-cta"]')).toBeFalsy();
    });

    it('renders an error state when the preview call fails', () => {
      const { compiled, fixture } = setup({
        previewExam: () => throwError(() => new Error('boom')),
      });

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');

      const errorState = compiled.querySelector('[data-testid="preview-error"]');
      expect(errorState).toBeTruthy();
    });
  });

  describe('with-data', () => {
    it('shows "de 18" with no warning styling when a row requests 6 with 18 in stock', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');

      const cell = compiled.querySelector('[data-cell-key="c1:t1:easy"]')!;
      expect(cell.textContent).toContain('de 18');
      expect(cell.querySelector('[data-testid="stock-warning"]')).toBeFalsy();
    });
  });

  describe('short-stock', () => {
    it('shows "solo 2" with a triangle-alert icon in the warning-stock tag when a row requests 6 with only 2 in stock', () => {
      const shortStock: StockBatchResult = {
        results: [
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 18 },
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Medium, available: 2 },
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Hard, available: 18 },
        ],
      };
      const { compiled, fixture } = setup({ stockBatch: () => of(shortStock) });

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:medium', '6');

      const cell = compiled.querySelector('[data-cell-key="c1:t1:medium"]')!;
      const warning = cell.querySelector('[data-testid="stock-warning"]');
      expect(warning).toBeTruthy();
      expect(warning!.textContent).toContain('solo 2');
      expect(warning!.querySelector('[data-testid="stock-warning-icon"]')).toBeTruthy();
      expect(warning!.querySelector('svg.lucide-triangle-alert')).toBeTruthy();
    });

    it('shows the puente-a-IA affordance ("Generar con IA" / "Elegir del banco" / "Bajar la cantidad") on a shortage cell (EB-R2)', () => {
      const shortStock: StockBatchResult = {
        results: [
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 18 },
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Medium, available: 2 },
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Hard, available: 18 },
        ],
      };
      const { compiled, fixture } = setup({ stockBatch: () => of(shortStock) });

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:medium', '6');

      const cell = compiled.querySelector('[data-cell-key="c1:t1:medium"]')!;
      expect(cell.querySelector('[data-testid="bridge-generate-ai"]')).toBeTruthy();
      expect(cell.querySelector('[data-testid="bridge-choose-bank"]')).toBeTruthy();
      expect(cell.querySelector('[data-testid="bridge-lower-count"]')).toBeTruthy();
    });

    it('carries the cell curso·tema·dificultad·grado to the AI generator so it opens pre-filled', () => {
      const shortStock: StockBatchResult = {
        results: [
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 18 },
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Medium, available: 2 },
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Hard, available: 18 },
        ],
      };
      const { compiled, fixture, navigate } = setup({ stockBatch: () => of(shortStock) });

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:medium', '6');

      const cell = compiled.querySelector('[data-cell-key="c1:t1:medium"]')!;
      (
        cell.querySelector('[data-testid="bridge-generate-ai"] button') as HTMLButtonElement
      ).click();

      // `count` es el faltante exacto de la celda: el botón dice "Generar N con
      // IA" y el generador abría con 5 por default (audit 2026-08-15).
      expect(navigate).toHaveBeenCalledWith(['/app/ai/generate'], {
        queryParams: {
          courseId: 'c1',
          topicId: 't1',
          difficulty: Difficulty.Medium,
          gradeLevel: 'secundaria_1',
          count: 4,
        },
      });
    });
  });

  describe('lock / unlock "Generar versiones" (EB-R3/R4)', () => {
    it('locks with a reason when the table is only partially satisfiable', () => {
      const shortStock: StockBatchResult = {
        results: [
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 18 },
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Medium, available: 2 },
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Hard, available: 18 },
        ],
      };
      const { compiled, fixture } = setup({ stockBatch: () => of(shortStock) });

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');
      setCellCount(compiled, fixture, 'c1:t1:medium', '6');

      const button = compiled.querySelector<HTMLButtonElement>(
        '[data-testid="generate-versions"] button',
      )!;
      expect(button.disabled).toBe(true);
      expect(compiled.querySelector('[data-testid="lock-reason"]')).toBeTruthy();
    });

    /**
     * Audit 2026-08-15: on a freshly loaded grid the button was disabled with a
     * padlock, `title=null` and NO `lock-reason` in the DOM at all — the reason
     * only rendered once at least one cell had a count. Same "dead, mute
     * control" class of bug the previous audit fixed for "Cargar plantilla".
     */
    it('explains the lock on a freshly loaded grid, before any cell has a count', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      const button = compiled.querySelector<HTMLButtonElement>(
        '[data-testid="generate-versions"] button',
      )!;
      expect(button.disabled).toBe(true);
      const reason = compiled.querySelector('[data-testid="lock-reason"]');
      expect(reason).toBeTruthy();
      expect(reason!.textContent).toContain('Escribe cuántas preguntas');
    });

    it('unlocks when every requested cell is fully satisfiable', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');

      const button = compiled.querySelector<HTMLButtonElement>(
        '[data-testid="generate-versions"] button',
      )!;
      expect(button.disabled).toBe(false);
      expect(compiled.querySelector('[data-testid="lock-reason"]')).toBeFalsy();
    });
  });

  /**
   * Audit 2026-08-15, reproducido en la app corriendo: escribir "12" en una
   * celda disparaba DOS `POST /exams/preview` (uno por tecla) y la celda
   * terminaba mostrando 1 solo id — la respuesta del "1" llegaba después de la
   * del "12" y la sobrescribía, porque `mergePreview` no tenía ningún guard de
   * orden (a diferencia de `loadTemplate`, que sí lo tiene).
   */
  describe('preview — debounce por celda y descarte de respuestas obsoletas', () => {
    it('dispara UNA sola preview por celda aunque el número se escriba tecla por tecla', () => {
      const previewExam = vi.fn((_payload: { blueprint: { count: number }[] }) =>
        of<PreviewExamResult>({
          selections: [
            {
              rowIndex: 0,
              courseId: 'c1',
              topicId: 't1',
              difficulty: Difficulty.Easy,
              questionIds: [],
            },
          ],
          shortages: [],
        }),
      );
      const { compiled, fixture } = setup({ previewExam });

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      previewExam.mockClear();

      typeCellCount(compiled, fixture, 'c1:t1:easy', '12');
      expect(previewExam).not.toHaveBeenCalled();

      vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
      fixture.detectChanges();

      expect(previewExam).toHaveBeenCalledTimes(1);
      expect(previewExam.mock.calls[0][0].blueprint[0].count).toBe(12);
    });

    it('se queda con la respuesta del ÚLTIMO valor aunque la anterior llegue tarde', () => {
      const first = new Subject<PreviewExamResult>();
      const second = new Subject<PreviewExamResult>();
      let call = 0;
      const previewExam = vi.fn(() => (call++ === 0 ? first : second));
      const { compiled, fixture } = setup({ previewExam });

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      previewExam.mockClear();
      call = 0;

      setCellCount(compiled, fixture, 'c1:t1:easy', '1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '12');
      expect(previewExam).toHaveBeenCalledTimes(2);

      // La respuesta del "12" llega primero, la del "1" (obsoleta) después.
      second.next({
        selections: [
          {
            rowIndex: 0,
            courseId: 'c1',
            topicId: 't1',
            difficulty: Difficulty.Easy,
            questionIds: ['q1', 'q2', 'q3'],
          },
        ],
        shortages: [],
      });
      first.next({
        selections: [
          {
            rowIndex: 0,
            courseId: 'c1',
            topicId: 't1',
            difficulty: Difficulty.Easy,
            questionIds: ['zz'],
          },
        ],
        shortages: [],
      });
      fixture.detectChanges();

      const ids = compiled.querySelector(
        '[data-testid="preview-ids"][data-cell-key="c1:t1:easy"]',
      )!.textContent;
      expect(ids).toContain('q1');
      expect(ids).not.toContain('zz');
    });

    it('no cancela la preview de OTRA celda — el debounce es por celda, no global', () => {
      const previewExam = vi.fn((payload: { blueprint: { difficulty: Difficulty }[] }) =>
        of<PreviewExamResult>({
          selections: [
            {
              rowIndex: 0,
              courseId: 'c1',
              topicId: 't1',
              difficulty: payload.blueprint[0].difficulty,
              questionIds: payload.blueprint[0].difficulty === Difficulty.Easy ? ['e1'] : ['m1'],
            },
          ],
          shortages: [],
        }),
      );
      const { compiled, fixture } = setup({ previewExam });

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      previewExam.mockClear();

      typeCellCount(compiled, fixture, 'c1:t1:easy', '2');
      typeCellCount(compiled, fixture, 'c1:t1:medium', '3');
      vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
      fixture.detectChanges();

      expect(previewExam).toHaveBeenCalledTimes(2);
      expect(
        compiled.querySelector('[data-testid="preview-ids"][data-cell-key="c1:t1:easy"]')!
          .textContent,
      ).toContain('e1');
      expect(
        compiled.querySelector('[data-testid="preview-ids"][data-cell-key="c1:t1:medium"]')!
          .textContent,
      ).toContain('m1');
    });
  });

  describe('EB-R5 — editing one cell does not re-roll another cell already previewed', () => {
    it('leaves the easy cell preview untouched when the medium cell is edited afterward, and calls preview with a single-row blueprint per edit', () => {
      const previewExam = vi.fn(
        (payload: { blueprint: { difficulty: Difficulty; count: number }[] }) => {
          const row = payload.blueprint[0];
          const ids =
            row.difficulty === Difficulty.Easy
              ? ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']
              : ['q9', 'q10', 'q11', 'q12'];
          return of<PreviewExamResult>({
            selections: [
              {
                rowIndex: 0,
                courseId: 'c1',
                topicId: 't1',
                difficulty: row.difficulty,
                questionIds: ids,
              },
            ],
            shortages: [],
          });
        },
      );
      const { compiled, fixture } = setup({ previewExam });

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');

      const easyCellBefore = compiled.querySelector(
        '[data-testid="preview-ids"][data-cell-key="c1:t1:easy"]',
      )!.textContent;
      expect(easyCellBefore).toContain('q1');

      previewExam.mockClear();
      setCellCount(compiled, fixture, 'c1:t1:medium', '4');

      expect(previewExam).toHaveBeenCalledTimes(1);
      const secondCallPayload = previewExam.mock.calls[0][0] as {
        blueprint: { difficulty: Difficulty }[];
      };
      expect(secondCallPayload.blueprint).toHaveLength(1);
      expect(secondCallPayload.blueprint[0].difficulty).toBe(Difficulty.Medium);

      const easyCellAfter = compiled.querySelector(
        '[data-testid="preview-ids"][data-cell-key="c1:t1:easy"]',
      )!.textContent;
      expect(easyCellAfter).toBe(easyCellBefore);
      const mediumCellAfter = compiled.querySelector(
        '[data-testid="preview-ids"][data-cell-key="c1:t1:medium"]',
      )!.textContent;
      expect(mediumCellAfter).toContain('q9');
    });
  });

  /**
   * EB-R7, revisado en el audit 2026-08-15: los dos layouts vivían SIEMPRE en el
   * DOM (`hidden md:block` / `md:hidden`), o sea 1,656 inputs para 828 celdas
   * reales y 13,136 nodos. El oculto no era tabulable ni lo leían los lectores
   * (es `display:none`), pero sí lo paga el parse inicial y cada ciclo de change
   * detection. Ahora solo se monta el layout del viewport actual.
   */
  describe('responsive (EB-R7)', () => {
    it('monta SOLO la tabla en desktop — nada de una segunda copia oculta', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="content-cards-mobile"]')).toBeFalsy();
    });

    it('monta SOLO las tarjetas en móvil, con la vista previa después de ellas', () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }));
      try {
        const { compiled, fixture } = setup();

        selectGradeLevel(compiled, fixture, 'secundaria_1');
        // Los cursos arrancan colapsados en móvil — abrimos el primero para
        // poder mirar el orden de las tarjetas.
        (
          compiled.querySelector('[data-testid="course-group-header"]') as HTMLButtonElement
        ).click();
        fixture.detectChanges();

        const mobile = compiled.querySelector('[data-testid="content-cards-mobile"]')!;
        expect(mobile).toBeTruthy();
        expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeFalsy();

        const card = mobile.querySelector('[data-testid="builder-card"]');
        expect(card).toBeTruthy();

        const cardsIndex = Array.from(mobile.children).findIndex(
          (el) => el === card || el.contains(card!),
        );
        const previewPanel = mobile.querySelector('[data-testid="preview-panel"]');
        expect(previewPanel).toBeTruthy();
        const previewIndex = Array.from(mobile.children).indexOf(previewPanel as Element);
        expect(previewIndex).toBeGreaterThan(cardsIndex);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('sticky column header', () => {
    it('keeps every column header cell sticky at the top so it stays visible while scrolling the grid', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      const headers = compiled.querySelectorAll('[data-testid="content-table-desktop"] thead th');
      expect(headers.length).toBeGreaterThan(0);
      headers.forEach((th) => {
        expect(th.className).toContain('sticky');
        expect(th.className).toContain('top-0');
      });
    });
  });

  describe('per-level totals', () => {
    it('shows live per-difficulty totals and a grand total that update as requested counts change', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');
      setCellCount(compiled, fixture, 'c1:t1:medium', '3');

      expect(compiled.querySelector('[data-testid="total-easy"]')!.textContent).toContain('6');
      expect(compiled.querySelector('[data-testid="total-medium"]')!.textContent).toContain('3');
      expect(compiled.querySelector('[data-testid="total-hard"]')!.textContent).toContain('0');
      expect(compiled.querySelector('[data-testid="grand-total"]')!.textContent).toContain('9');

      setCellCount(compiled, fixture, 'c1:t1:hard', '2');

      expect(compiled.querySelector('[data-testid="total-hard"]')!.textContent).toContain('2');
      expect(compiled.querySelector('[data-testid="grand-total"]')!.textContent).toContain('11');
    });
  });

  describe('shortage highlight', () => {
    it('visually tints a shortage cell with the warning-stock token', () => {
      const shortStock: StockBatchResult = {
        results: [
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 18 },
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Medium, available: 2 },
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Hard, available: 18 },
        ],
      };
      const { compiled, fixture } = setup({ stockBatch: () => of(shortStock) });

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:medium', '6');

      const cell = compiled.querySelector('[data-cell-key="c1:t1:medium"]')!;
      expect(cell.className).toContain('bg-warn-bg');
    });

    it('keeps a fully satisfied cell free of the shortage tint', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');

      const cell = compiled.querySelector('[data-cell-key="c1:t1:easy"]')!;
      expect(cell.className).not.toContain('bg-warn-bg');
    });

    it('renders a muted "de 0" stock label (not alarming) for an untouched zero-stock cell', () => {
      const { compiled, fixture } = setup({ stockBatch: () => of(MIXED_STOCK) });

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      const cell = compiled.querySelector('[data-cell-key="c1:t1:medium"]')!;
      const stockOk = cell.querySelector('[data-testid="stock-ok"]')!;
      expect(stockOk.textContent).toContain('de 0');
      expect(stockOk.className).toContain('text-n400');
      expect(cell.className).not.toContain('bg-warn-bg');
    });
  });

  describe('course grouping', () => {
    it('fetches topics for every course via a single batched getTopicsForCourses call, not one per course', () => {
      const courses: Course[] = [
        { id: 'c1', name: 'Matemática', stage: 'preuniversitario' },
        { id: 'c2', name: 'Comunicación', stage: 'preuniversitario' },
      ];
      const topicsByCourse: Record<string, Topic[]> = {
        c1: [{ id: 't1', name: 'Álgebra', courseId: 'c1' }],
        c2: [{ id: 't2', name: 'Lectura', courseId: 'c2' }],
      };
      const { compiled, fixture, getTopicsForCourses } = setup({
        getCourses: () => of(courses),
        getTopicsForCourses: (courseIds: string[]) =>
          of(courseIds.flatMap((id) => topicsByCourse[id] ?? [])),
      });

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      expect(getTopicsForCourses).toHaveBeenCalledTimes(1);
      expect(getTopicsForCourses).toHaveBeenCalledWith(['c1', 'c2'], 'secundaria_1');
    });

    it("renders a course subheading row before each course's topics when the grid spans multiple courses", () => {
      const courses: Course[] = [
        { id: 'c1', name: 'Matemática', stage: 'preuniversitario' },
        { id: 'c2', name: 'Comunicación', stage: 'preuniversitario' },
      ];
      const topicsByCourse: Record<string, Topic[]> = {
        c1: [{ id: 't1', name: 'Álgebra', courseId: 'c1' }],
        c2: [{ id: 't2', name: 'Lectura', courseId: 'c2' }],
      };
      const stock: StockBatchResult = {
        results: [
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 18 },
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Medium, available: 18 },
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Hard, available: 18 },
          { courseId: 'c2', topicId: 't2', difficulty: Difficulty.Easy, available: 18 },
          { courseId: 'c2', topicId: 't2', difficulty: Difficulty.Medium, available: 18 },
          { courseId: 'c2', topicId: 't2', difficulty: Difficulty.Hard, available: 18 },
        ],
      };
      const { compiled, fixture } = setup({
        getCourses: () => of(courses),
        getTopicsForCourses: (courseIds: string[]) =>
          of(courseIds.flatMap((id) => topicsByCourse[id] ?? [])),
        stockBatch: () => of(stock),
      });

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      const desktop = compiled.querySelector('[data-testid="content-table-desktop"]')!;
      const headers = desktop.querySelectorAll('[data-testid="course-group-header"]');
      expect(headers.length).toBe(2);
      expect(headers[0].textContent).toContain('Matemática');
      expect(headers[1].textContent).toContain('Comunicación');
    });

    it('collapses a course when its header is clicked, hiding that course rows only', () => {
      const courses: Course[] = [
        { id: 'c1', name: 'Matemática', stage: 'preuniversitario' },
        { id: 'c2', name: 'Comunicación', stage: 'preuniversitario' },
      ];
      const topicsByCourse: Record<string, Topic[]> = {
        c1: [{ id: 't1', name: 'Álgebra', courseId: 'c1' }],
        c2: [{ id: 't2', name: 'Lectura', courseId: 'c2' }],
      };
      const stock: StockBatchResult = {
        results: [
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 18 },
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Medium, available: 18 },
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Hard, available: 18 },
          { courseId: 'c2', topicId: 't2', difficulty: Difficulty.Easy, available: 18 },
          { courseId: 'c2', topicId: 't2', difficulty: Difficulty.Medium, available: 18 },
          { courseId: 'c2', topicId: 't2', difficulty: Difficulty.Hard, available: 18 },
        ],
      };
      const { compiled, fixture } = setup({
        getCourses: () => of(courses),
        getTopicsForCourses: (courseIds: string[]) =>
          of(courseIds.flatMap((id) => topicsByCourse[id] ?? [])),
        stockBatch: () => of(stock),
      });

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      const desktop = compiled.querySelector('[data-testid="content-table-desktop"]')!;
      expect(desktop.querySelectorAll('[data-testid="builder-row"]').length).toBe(2);

      const firstHeader = desktop.querySelector(
        '[data-testid="course-group-header"]',
      ) as HTMLElement;
      firstHeader.click();
      fixture.detectChanges();

      const rows = desktop.querySelectorAll('[data-testid="builder-row"]');
      expect(rows.length).toBe(1);
      expect(rows[0].textContent).toContain('Lectura');
    });

    it('renders the desktop course header as a keyboard-focusable <button>, not a bare <tr> (audit P2 — a11y)', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      const desktop = compiled.querySelector('[data-testid="content-table-desktop"]')!;
      const header = desktop.querySelector('[data-testid="course-group-header"]') as HTMLElement;
      expect(header.tagName).toBe('BUTTON');
      expect(header.getAttribute('type')).toBe('button');
    });

    it('collapses every course with "Colapsar todo" and restores them with "Expandir todo"', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      const desktop = compiled.querySelector('[data-testid="content-table-desktop"]')!;
      const initialRows = desktop.querySelectorAll('[data-testid="builder-row"]').length;
      expect(initialRows).toBeGreaterThan(0);

      (compiled.querySelector('[data-testid="collapse-all"] button') as HTMLElement).click();
      fixture.detectChanges();
      expect(desktop.querySelectorAll('[data-testid="builder-row"]').length).toBe(0);

      (compiled.querySelector('[data-testid="expand-all"] button') as HTMLElement).click();
      fixture.detectChanges();
      expect(desktop.querySelectorAll('[data-testid="builder-row"]').length).toBe(initialRows);
    });

    it("merges a template-loaded whole-course sentinel row into the SAME course header as that course's pre-existing (non-consecutive) topic rows, not a duplicate header", () => {
      // Reproduces the real bug: the grade-level grid populates real topic
      // rows for BOTH courses first — [c1/t1, c2/t2] — then
      // `bulkLoadFromBlueprint` APPENDS the resolved whole-course sentinel
      // row for c1 at the END of `store.rows()`: [c1/t1, c2/t2, c1/""].
      // c1's two rows are no longer consecutive (c2's row sits between
      // them). A consecutive-run group-by would wrongly split c1 into two
      // separate `course-group-header`s sharing one `courseId`, which
      // duplicates the `@for`'s `track group.courseId` key (NG0955).
      const courses: Course[] = [
        { id: 'c1', name: 'Matemática', stage: 'preuniversitario' },
        { id: 'c2', name: 'Comunicación', stage: 'preuniversitario' },
      ];
      const topicsByCourse: Record<string, Topic[]> = {
        c1: [{ id: 't1', name: 'Álgebra', courseId: 'c1' }],
        c2: [{ id: 't2', name: 'Lectura', courseId: 'c2' }],
      };
      const stock: StockBatchResult = {
        results: [
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 18 },
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Medium, available: 18 },
          { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Hard, available: 18 },
          { courseId: 'c2', topicId: 't2', difficulty: Difficulty.Easy, available: 18 },
          { courseId: 'c2', topicId: 't2', difficulty: Difficulty.Medium, available: 18 },
          { courseId: 'c2', topicId: 't2', difficulty: Difficulty.Hard, available: 18 },
        ],
      };
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', count: 15, difficulty: Difficulty.Easy }],
          weekNumber: null,
          templateId: 'tpl-uncp',
        }),
      );
      const { compiled, fixture } = setup({
        getCourses: () => of(courses),
        getTopicsForCourses: (courseIds: string[]) =>
          of(courseIds.flatMap((id) => topicsByCourse[id] ?? [])),
        stockBatch: () => of(stock),
        resolveBlueprint,
        getUniversityTracks: () => of([]),
      });

      selectGradeLevel(compiled, fixture, 'secundaria_1'); // populates [c1/t1, c2/t2] first
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="load-template"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const desktop = compiled.querySelector('[data-testid="content-table-desktop"]')!;
      const headers = desktop.querySelectorAll('[data-testid="course-group-header"]');
      expect(headers.length).toBe(2); // one group per course — c1's two rows merged, not split
      const c1Header = Array.from(headers).find((h) => h.textContent?.includes('Matemática'));
      expect(c1Header).toBeTruthy();
      expect(c1Header!.textContent).toContain('· 2'); // both the real topic row AND the sentinel row

      const rows = desktop.querySelectorAll('[data-testid="builder-row"]');
      expect(rows.length).toBe(3); // c1/t1, c2/t2, c1 sentinel
    });
  });

  describe('row density', () => {
    it('applies a hover affordance class to each content row', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      const row = compiled.querySelector('[data-testid="builder-row"]')!;
      expect(row.className).toContain('hover:bg-primary-50');
    });
  });

  describe('commit lifecycle', () => {
    /**
     * DECISIÓN de producto (2026-08-17, opción (a) del audit 2026-08-15): el
     * builder ya NO genera. Crea el examen `draft` y lleva a la pantalla de
     * revisión, que es la única donde las preguntas se pueden LEER — antes el
     * builder saltaba directo a las formas y el backend auto-confirmaba, así
     * que un click sellaba para siempre un examen que el docente nunca vio.
     * La cantidad de formas elegida acá viaja como query param al punto donde
     * ahora sí se genera.
     */
    it('creates the exam and goes to the review screen, carrying the chosen form count', () => {
      const { compiled, fixture, createExam, navigate } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');
      selectFromUiSelect(compiled, fixture, 'builder-version-count', '4');

      const button = compiled.querySelector<HTMLButtonElement>(
        '[data-testid="generate-versions"] button',
      )!;
      button.click();
      fixture.detectChanges();

      expect(createExam).toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/app/exams', 'exam-1'], {
        queryParams: { formas: 4 },
      });
    });

    it('never generates anything from the builder — nothing gets sealed before it is read', () => {
      const { compiled, fixture, generateVersions } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');
      compiled
        .querySelector<HTMLButtonElement>('[data-testid="generate-versions"] button')!
        .click();
      fixture.detectChanges();

      expect(generateVersions).not.toHaveBeenCalled();
    });

    it('labels the primary action for what it now does', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      const button = compiled.querySelector('[data-testid="generate-versions"]')!;
      expect(button.textContent).toMatch(/revisar/i);
    });

    /**
     * Audit 2026-08-15: el título se autogeneraba como
     * "Examen {grado} — {fecha}" sin forma de cambiarlo, así que dos exámenes
     * del mismo día y grado quedaban con el MISMO nombre en una lista que se
     * busca por título. Y la cantidad de formas estaba hardcodeada en 2: el
     * docente que quería 4 tenía que generar 2, entrar a la pantalla de formas
     * y regenerar (compilación desperdiciada + 4 clicks + modal de peligro).
     */
    it('usa el nombre escrito por el docente', () => {
      const { compiled, fixture, createExam } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');
      const nameInput = compiled.querySelector<HTMLInputElement>('input[name="exam-title"]')!;
      nameInput.value = 'Simulacro Área II — marzo';
      nameInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      compiled
        .querySelector<HTMLButtonElement>('[data-testid="generate-versions"] button')!
        .click();
      fixture.detectChanges();

      expect(createExam).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Simulacro Área II — marzo' }),
      );
    });

    it('cae al título autogenerado cuando el campo queda vacío (o en puros espacios)', () => {
      const { compiled, fixture, createExam } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');
      const nameInput = compiled.querySelector<HTMLInputElement>('input[name="exam-title"]')!;
      nameInput.value = '   ';
      nameInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      compiled
        .querySelector<HTMLButtonElement>('[data-testid="generate-versions"] button')!
        .click();
      fixture.detectChanges();

      const payload = createExam.mock.calls[0][0] as { title: string };
      expect(payload.title).toMatch(/^Examen .+ — /);
    });

    it('lleva la cantidad de formas elegida a la pantalla que ahora genera', () => {
      const { compiled, fixture, navigate } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');
      selectFromUiSelect(compiled, fixture, 'builder-version-count', '4');

      compiled
        .querySelector<HTMLButtonElement>('[data-testid="generate-versions"] button')!
        .click();
      fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith(['/app/exams', 'exam-1'], {
        queryParams: { formas: 4 },
      });
    });

    it('lleva 2 formas por defecto — el docente que no toca nada no cambia de experiencia', () => {
      const { compiled, fixture, navigate } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');
      compiled
        .querySelector<HTMLButtonElement>('[data-testid="generate-versions"] button')!
        .click();
      fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith(['/app/exams', 'exam-1'], {
        queryParams: { formas: 2 },
      });
    });

    it('conserva nombre y cantidad de formas si el docente sale y vuelve', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');
      const nameInput = compiled.querySelector<HTMLInputElement>('input[name="exam-title"]')!;
      nameInput.value = 'Simulacro de marzo';
      nameInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      selectFromUiSelect(compiled, fixture, 'builder-version-count', '3');

      const saved = JSON.parse(sessionStorage.getItem(BUILDER_STATE_KEY)!);
      expect(saved.title).toBe('Simulacro de marzo');
      expect(saved.versionCount).toBe(3);
    });
  });

  /**
   * Audit 2026-08-15: "Manual" venía preseleccionado (y es `sortOrder: 0` en el
   * catálogo), así que un docente novato aterrizaba sobre una matriz de 828
   * celdas en blanco sin que nada le dijera que existe un camino guiado que
   * arma el examen solo. Y los cuatro tipos se ofrecían sin una línea que
   * explique en qué se diferencian.
   *
   * NO se cambió el default a un tipo guiado (que fue la recomendación inicial
   * del audit): las plantillas solo existen para universidades
   * preuniversitarias, así que preseleccionar "Examen tipo admisión" sería
   * activamente incorrecto para un colegio de primaria — y dispararía
   * `getUniversities` en cada carga. La elección ahora es EXPLÍCITA y explicada.
   */
  /**
   * Audit 2026-08-15: el dropdown ofrecía los 12 grados del catálogo y 11
   * terminaban en "No hay preguntas aprobadas para este grado todavía" — el
   * banco sembrado es 100% `pre`. El docente descubría el callejón DESPUÉS de
   * elegir. Ahora el conteo por grado (`GET /exams/stock/grades`) viene con la
   * pantalla y la etiqueta lo dice antes.
   */
  describe('grado — decir cuáles tienen banco ANTES de elegir', () => {
    it('anota cada grado con sus preguntas disponibles', () => {
      const { compiled, fixture } = setup({
        gradeLevelStock: () =>
          of({
            results: [
              { gradeLevel: 'pre', available: 64218 },
              { gradeLevel: 'secundaria_1', available: 12 },
            ],
          }),
      });

      const labels = openAndReadGradeOptions(compiled, fixture);
      expect(labels).toContain(`${GRADE_LEVEL_LABELS['pre']} · 64218 preguntas`);
      expect(labels).toContain(`${GRADE_LEVEL_LABELS['secundaria_1']} · 12 preguntas`);
    });

    it('marca los grados sin banco en vez de dejar que el docente los descubra por prueba y error', () => {
      const { compiled, fixture } = setup({
        gradeLevelStock: () => of({ results: [{ gradeLevel: 'pre', available: 5 }] }),
      });

      const labels = openAndReadGradeOptions(compiled, fixture);
      expect(labels).toContain(`${GRADE_LEVEL_LABELS['primaria_1']} · sin preguntas`);
    });

    it('si el conteo falla, las etiquetas quedan como siempre — nunca miente diciendo "sin preguntas"', () => {
      const { compiled, fixture } = setup({
        gradeLevelStock: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });

      const labels = openAndReadGradeOptions(compiled, fixture);
      expect(labels).toContain(GRADE_LEVEL_LABELS['pre']);
      expect(labels.some((label) => label.includes('sin preguntas'))).toBe(false);
    });
  });

  /**
   * Audit 2026-08-15: elegir un tipo no-manual disparaba el pre-warm del grado
   * `pre` y pintaba las 276 filas del temario ENTERO debajo de un formulario de
   * tres campos todavía vacío — puro ruido antes de que la plantilla exista.
   * El pre-warm (la fetch) se queda; lo que espera es el render.
   */
  describe('plantilla — la grilla no aparece antes de que haya plantilla', () => {
    it('esconde el temario mientras el tipo guiado no cargó nada', () => {
      const { compiled, fixture } = setup({ getUniversityTracks: () => of(TRACKS) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');

      expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="template-pending-hint"]')).toBeTruthy();
    });

    it('la muestra apenas la plantilla trae filas', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', topicId: 't1', count: 9, difficulty: Difficulty.Hard }],
          weekNumber: null,
          templateId: 'tpl-1',
        }),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');

      // La grilla llega plegada; lo que aparece es el recibo de la plantilla.
      expect(compiled.querySelector('[data-testid="template-summary"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="template-pending-hint"]')).toBeFalsy();
      openGrid(compiled, fixture);
      expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeTruthy();
    });

    it('en manual la grilla sigue apareciendo con solo elegir el grado', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeTruthy();
    });
  });

  describe('vocabulario y accesibilidad', () => {
    /**
     * Audit 2026-08-15: la etiqueta decía "Track" (jerga en inglés) mientras las
     * opciones decían "Área I — …". Para UNI, que usa ciclos y no áreas,
     * "Área" también sería incorrecto — así que la etiqueta se deriva.
     */
    it('llama "Área" al campo cuando la universidad usa áreas de admisión', () => {
      const { compiled, fixture } = setup({
        getUniversityTracks: () =>
          of([{ id: 'trk1', code: 'II', name: 'Ingenierías', kind: 'area' as const }]),
      });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');

      const label = compiled.querySelector('[data-testid="track-select"]')!.textContent ?? '';
      expect(label).toContain('Área');
      expect(label).not.toContain('Track');
    });

    it('lo llama "Ciclo" cuando son ciclos de preparación, no áreas', () => {
      // `TRACKS` is UNI's `cycle_track` fixture; the default mock returns no
      // tracks at all, which renders no field to name.
      const { compiled, fixture } = setup({ getUniversityTracks: () => of(TRACKS) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');

      const label = compiled.querySelector('[data-testid="track-select"]')!.textContent ?? '';
      expect(label).toContain('Ciclo');
      expect(label).not.toContain('Track');
    });

    it('cada input de la grilla se anuncia con su curso, tema y dificultad', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      const input = compiled.querySelector<HTMLInputElement>('input[name="requested-c1:t1:easy"]')!;
      expect(input.getAttribute('aria-label')).toBe('Preguntas de Matemática · Álgebra · Fácil');
    });
  });

  /**
   * El pedido: elegir el tipo de examen y llegar al botón sin rellenar nada.
   * La plantilla ya autocarga, así que lo único que separaba al docente de la
   * acción era la pared de celdas — 80 en la plantilla real de UNCP Área II.
   * La grilla pasa a ser opcional, NO desaparece: sigue siendo la única forma
   * de ajustar una celda, y se abre sola cuando hay algo que arreglar.
   */
  describe('grilla plegable — plantilla lista sin pared de celdas', () => {
    const TEMPLATE_BLUEPRINT = {
      blueprint: [{ courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, count: 3 }],
      weekNumber: null,
      templateId: 'tpl-1',
    };

    it('no monta la tabla cuando la plantilla resolvió sola — solo el resumen y el disparador', () => {
      const { compiled, fixture } = setup({ resolveBlueprint: () => of(TEMPLATE_BLUEPRINT) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');

      expect(compiled.querySelector('[data-testid="template-summary"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="grid-disclosure"]')).toBeTruthy();
    });

    it('el disparador abre la grilla — ajustar a mano sigue siendo posible', () => {
      const { compiled, fixture } = setup({ resolveBlueprint: () => of(TEMPLATE_BLUEPRINT) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');

      (
        compiled.querySelector('[data-testid="grid-disclosure"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeTruthy();
    });

    it('deja el botón de avanzar habilitado sin abrir la grilla ni una vez', () => {
      const { compiled, fixture } = setup({ resolveBlueprint: () => of(TEMPLATE_BLUEPRINT) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');

      const generate = compiled.querySelector<HTMLButtonElement>(
        '[data-testid="generate-versions"] button',
      )!;
      expect(generate.disabled).toBe(false);
    });

    it('abre la grilla sola cuando el stock no alcanza — nadie arregla lo que no ve', () => {
      // MIXED_STOCK, no ZERO_STOCK: con el banco entero en cero la pantalla es
      // el estado vacío ("No hay preguntas aprobadas"), no una grilla con
      // faltantes. El faltante que interesa es el de UNA celda.
      const { compiled, fixture } = setup({
        resolveBlueprint: () =>
          of({
            blueprint: [{ courseId: 'c1', topicId: 't1', difficulty: Difficulty.Medium, count: 3 }],
            weekNumber: null,
            templateId: 'tpl-1',
          }),
        stockBatch: () => of(MIXED_STOCK),
      });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');

      expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeTruthy();
      // Y sin disparador para volver a plegarla mientras siga rota.
      expect(compiled.querySelector('[data-testid="grid-disclosure"]')).toBeTruthy();
    });

    it('manual no cambia: la grilla ES la herramienta, se monta abierta', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="grid-disclosure"]')).toBeFalsy();
    });
  });

  describe('tipo de examen — elección explicada, sin trampa por default', () => {
    it('no preselecciona ningún tipo y no toca la red por adelantado', () => {
      const { compiled, getUniversities } = setup();

      const trigger = compiled.querySelector('[data-testid="exam-type-select"] [role="combobox"]')!;
      expect(trigger.textContent).toMatch(/cómo quieres armarlo/i);
      expect(getUniversities).not.toHaveBeenCalled();
    });

    it('mientras no se elige, invita al camino guiado en vez de dejar la pantalla muda', () => {
      const { compiled } = setup();

      const hint = compiled.querySelector('[data-testid="exam-type-hint"]')!;
      expect(hint).toBeTruthy();
      expect(hint.textContent).toMatch(/simulacro/i);
    });

    it('explica el tipo elegido — manual dice que lo armas tú, curso por curso', () => {
      const { compiled, fixture } = setup();

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Manual');

      const help = compiled.querySelector('[data-testid="exam-type-help"]')!;
      expect(help.textContent).toMatch(/curso por curso/i);
    });

    it('explica un tipo guiado — dice que la plantilla lo arma por ti', () => {
      const { compiled, fixture } = setup();

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');

      const help = compiled.querySelector('[data-testid="exam-type-help"]')!;
      expect(help.textContent).toMatch(/plantilla/i);
    });
  });

  describe('tipo de examen — manual default invariant (critical: zero behavior change from today)', () => {
    it('hides every template affordance until a non-manual type is chosen, without ever calling getUniversities', () => {
      const { compiled, getUniversities } = setup();

      expect(compiled.querySelector('[data-testid="university-select"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="track-select"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="course-multiselect"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="load-template"]')).toBeFalsy();
      expect(getUniversities).not.toHaveBeenCalled();

      // Grado stays a manual, interactive choice while the exam type is
      // manual (the default) — the derived-grade indicator only replaces it
      // for non-manual exam types.
      expect(compiled.querySelector('[data-testid="grade-level-select"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="grade-level-derived"]')).toBeFalsy();
    });

    it('keeps the grade-level -> manual content-table flow working exactly as before with the exam type left at its manual default', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');

      const cell = compiled.querySelector('[data-cell-key="c1:t1:easy"]')!;
      expect(cell.textContent).toContain('de 18');
      expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeTruthy();

      const button = compiled.querySelector<HTMLButtonElement>(
        '[data-testid="generate-versions"] button',
      )!;
      expect(button.disabled).toBe(false);
    });
  });

  describe('tipo de examen — switching away from manual', () => {
    it('shows the university select and fetches universities once a non-manual type is selected', () => {
      const { compiled, fixture, getUniversities } = setup();

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Fastest');

      expect(getUniversities).toHaveBeenCalledTimes(1);
      expect(compiled.querySelector('[data-testid="university-select"]')).toBeTruthy();
    });

    it('shows the course multi-select only for a "selected" course-scope exam type (fastest)', () => {
      const { compiled, fixture } = setup();

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Fastest');

      expect(compiled.querySelector('[data-testid="course-multiselect"]')).toBeTruthy();
    });

    it('does not show the course multi-select for an "all" course-scope exam type (eta)', () => {
      const { compiled, fixture } = setup();

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');

      expect(compiled.querySelector('[data-testid="course-multiselect"]')).toBeFalsy();
    });

    it('hides the track select when the selected university has no tracks (empty array is not an error)', () => {
      const { compiled, fixture } = setup({ getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');

      expect(compiled.querySelector('[data-testid="track-select"]')).toBeFalsy();
    });

    it('shows the track select when the selected university has tracks', () => {
      const { compiled, fixture } = setup({ getUniversityTracks: () => of(TRACKS) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');

      expect(compiled.querySelector('[data-testid="track-select"]')).toBeTruthy();
    });
  });

  describe('tipo de examen — grade level is derived, not an independent choice (real UX bug)', () => {
    it('auto-selects preuniversitario and pre-warms the content grid the instant a non-manual exam type is chosen, hiding the manual grade selector', () => {
      const { compiled, fixture, getCourses } = setup();

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');

      expect(compiled.querySelector('[data-testid="grade-level-select"]')).toBeFalsy();
      const derived = compiled.querySelector('[data-testid="grade-level-derived"]');
      expect(derived).toBeTruthy();
      expect(derived!.textContent).toContain('Pre-admisión');
      // El catálogo se pre-calienta igual (la fetch sale), pero el temario ya no
      // se PINTA hasta que la plantilla traiga filas — 276 filas debajo de un
      // formulario vacío eran puro ruido (audit 2026-08-15).
      expect(getCourses).toHaveBeenCalledWith('pre');
      expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="template-pending-hint"]')).toBeTruthy();
    });

    it('overrides an already-selected different grade level to preuniversitario when switching to a non-manual exam type', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');

      expect(compiled.querySelector('[data-testid="grade-level-select"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="grade-level-derived"]')!.textContent).toContain(
        'Pre-admisión',
      );
      // Las filas del grado viejo se reemplazaron, no se duplicaron — y con el
      // tipo guiado el temario espera a la plantilla, así que no se pinta ninguna.
      expect(compiled.querySelectorAll('[data-testid="builder-row"]').length).toBe(0);
    });

    it('does not rebuild or duplicate the grid when switching between two different non-manual exam types (already preuniversitario)', () => {
      const { compiled, fixture } = setup();

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Fastest');
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');

      // Ninguna fila pintada (el temario espera a la plantilla) y, sobre todo,
      // ninguna duplicada: el grado ya era `pre`, así que el grid no se rearma.
      expect(compiled.querySelectorAll('[data-testid="builder-row"]').length).toBe(0);
      expect(compiled.querySelector('[data-testid="template-pending-hint"]')).toBeTruthy();
    });

    it('resets grade level back to null when switching back to manual — selector reappears, derived indicator and grid disappear (EB-T invariant)', () => {
      const { compiled, fixture } = setup();

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      expect(compiled.querySelector('[data-testid="template-pending-hint"]')).toBeTruthy();

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Manual');

      expect(compiled.querySelector('[data-testid="grade-level-select"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="grade-level-derived"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeFalsy();
    });
  });

  /**
   * Audit 2026-08-15, medido en un viewport de 390×844: la columna de tarjetas
   * mide 114,314 px contra un contenedor de 783 px — **146 pantallas** de
   * scroll — y el footer con la acción principal era `position: static` en
   * `offsetTop: 114,735`. En desktop la grilla vive en un `max-h-[70vh]` con el
   * footer pegado abajo; en móvil el botón quedaba literalmente al final de
   * todo.
   */
  describe('móvil — la acción principal se alcanza', () => {
    it('deja el footer pegado abajo mientras se scrollea la grilla', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      const footer = compiled.querySelector('footer')!;
      expect(footer.className).toContain('sticky');
      expect(footer.className).toContain('bottom-0');
    });

    it('en pantalla angosta los cursos arrancan COLAPSADOS — el temario no entierra el trabajo', () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }));
      try {
        const { compiled, fixture } = setup();

        selectGradeLevel(compiled, fixture, 'secundaria_1');

        expect(
          compiled.querySelectorAll('[data-testid="course-group-header"]').length,
        ).toBeGreaterThan(0);
        expect(compiled.querySelector('[data-testid="builder-row"]')).toBeFalsy();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('en pantalla ancha siguen arrancando EXPANDIDOS (la grilla es una matriz para llenar)', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      expect(compiled.querySelector('[data-testid="builder-row"]')).toBeTruthy();
    });
  });

  /**
   * Audit 2026-08-18, medido en la app corriendo: cargar UNCP Área II (80
   * preguntas) y luego cambiar a UNI (100) dejaba un examen de 153 preguntas en
   * 26 celdas — las dos plantillas superpuestas, sin corresponder a ninguna
   * universidad, con el botón de generar habilitado y sin ningún aviso.
   */
  /**
   * Audit 2026-08-18: los cuatro flujos autocargan, y sin embargo el botón
   * seguía diciendo "Cargar plantilla" — el docente no sabe si tiene que
   * apretarlo. Y el multiselect de "Rápido" son 42 checkboxes sin buscador,
   * sin agrupar y sin "todos": una pared.
   */
  describe('ruido del formulario de plantilla', () => {
    it('el botón dice en qué estado está, en vez de fingir que hace falta', () => {
      const { compiled, fixture } = setup({
        getUniversityTracks: () => of([]),
        resolveBlueprint: () =>
          of<ResolveBlueprintResult>({
            blueprint: [{ courseId: 'c1', topicId: 't1', count: 4, difficulty: Difficulty.Easy }],
            weekNumber: null,
            templateId: 'tpl',
          }),
      });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      const antes = compiled.querySelector('[data-testid="load-template"]')!.textContent!;
      expect(antes).toMatch(/cargar plantilla/i);

      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');

      // Ya autocargó: el botón deja de pedir la acción y se ofrece como repetir.
      expect(compiled.querySelector('[data-testid="load-template"]')!.textContent).toMatch(
        /volver a cargar/i,
      );
    });

    it('tras un error el botón se ofrece como reintentar', () => {
      const { compiled, fixture } = setup({
        getUniversityTracks: () => of([]),
        resolveBlueprint: () => throwError(() => new HttpErrorResponse({ status: 404 })),
      });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');

      expect(compiled.querySelector('[data-testid="load-template"]')!.textContent).toMatch(
        /reintentar/i,
      );
    });

    it('el multiselect de cursos filtra por texto', () => {
      const { compiled, fixture } = setup({
        getCourses: () =>
          of([
            { id: 'c1', name: 'Aritmética', stage: 'preuniversitario' },
            { id: 'c2', name: 'Álgebra', stage: 'preuniversitario' },
            { id: 'c3', name: 'Química', stage: 'preuniversitario' },
          ]),
      });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Fastest');
      expect(
        compiled.querySelectorAll('[data-testid="course-multiselect"] input[type=checkbox]').length,
      ).toBe(3);

      const buscador = compiled.querySelector<HTMLInputElement>(
        '[data-testid="course-search"] input',
      )!;
      buscador.value = 'qu';
      buscador.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const visibles = [
        ...compiled.querySelectorAll('[data-testid="course-multiselect"] label'),
      ].map((l) => l.textContent!.trim());
      expect(visibles).toEqual(['Química']);
    });

    it('permite marcar y desmarcar todo de una, y dice cuántos van', () => {
      const { compiled, fixture } = setup({
        getCourses: () =>
          of([
            { id: 'c1', name: 'Aritmética', stage: 'preuniversitario' },
            { id: 'c2', name: 'Álgebra', stage: 'preuniversitario' },
          ]),
      });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Fastest');

      (
        compiled.querySelector('[data-testid="courses-select-all"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      expect(
        [
          ...compiled.querySelectorAll<HTMLInputElement>(
            '[data-testid="course-multiselect"] input',
          ),
        ].every((i) => i.checked),
      ).toBe(true);
      expect(compiled.querySelector('[data-testid="courses-count"]')!.textContent).toContain('2');

      (compiled.querySelector('[data-testid="courses-clear"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(
        [
          ...compiled.querySelectorAll<HTMLInputElement>(
            '[data-testid="course-multiselect"] input',
          ),
        ].some((i) => i.checked),
      ).toBe(false);
    });
  });

  describe('plantillas — una reemplaza a la otra, nunca se suman', () => {
    function resolveCon(rows: { courseId: string; count: number; difficulty: Difficulty }[]) {
      return () =>
        of<ResolveBlueprintResult>({
          // `topicId` para que caigan en la celda que el fixture de stock cubre
          // (c1:t1) y el botón dependa del reemplazo, no de un faltante.
          blueprint: rows.map((r) => ({
            courseId: r.courseId,
            topicId: 't1',
            count: r.count,
            difficulty: r.difficulty,
          })),
          weekNumber: null,
          templateId: 'tpl',
        });
    }

    it('cambiar de universidad descarta lo que trajo la plantilla anterior', () => {
      let call = 0;
      const resolveBlueprint = vi.fn(() =>
        call++ === 0
          ? resolveCon([{ courseId: 'c1', count: 9, difficulty: Difficulty.Hard }])()
          : resolveCon([{ courseId: 'c1', count: 4, difficulty: Difficulty.Medium }])(),
      );
      const { compiled, fixture } = setup({
        resolveBlueprint,
        getUniversityTracks: () => of([]),
        getUniversities: () => of([...UNIVERSITIES, { id: 'u2', code: 'uncp', name: 'UNCP' }]),
      });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      openGrid(compiled, fixture);
      expect(compiled.querySelector('[data-testid="grand-total"]')!.textContent).toContain('9');

      selectFromUiSelect(compiled, fixture, 'university-select', 'UNCP');
      openGrid(compiled, fixture);

      // 4, no 13: la segunda plantilla reemplaza, no se suma.
      expect(compiled.querySelector('[data-testid="grand-total"]')!.textContent).toContain('4');
    });

    it('una plantilla que falla (404/400) no deja el examen anterior listo para generar', () => {
      let call = 0;
      const resolveBlueprint = vi.fn(() =>
        call++ === 0
          ? resolveCon([{ courseId: 'c1', count: 6, difficulty: Difficulty.Easy }])()
          : throwError(() => new HttpErrorResponse({ status: 404 })),
      );
      const { compiled, fixture } = setup({
        resolveBlueprint,
        getUniversityTracks: () => of([]),
        getUniversities: () => of([...UNIVERSITIES, { id: 'u2', code: 'uncp', name: 'UNCP' }]),
      });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      expect(
        compiled.querySelector<HTMLButtonElement>('[data-testid="generate-versions"] button')!
          .disabled,
      ).toBe(false);

      selectFromUiSelect(compiled, fixture, 'university-select', 'UNCP');

      expect(compiled.querySelector('[data-testid="template-error"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="template-summary"]')).toBeFalsy();
      const btn = compiled.querySelector<HTMLButtonElement>(
        '[data-testid="generate-versions"] button',
      );
      expect(btn === null || btn.disabled).toBe(true);
    });

    it('escribir la cantidad total re-resuelve la plantilla sola', () => {
      const resolveBlueprint = vi.fn((_payload: ResolveBlueprintPayload) =>
        resolveCon([{ courseId: 'c1', count: 5, difficulty: Difficulty.Medium }])(),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      resolveBlueprint.mockClear();

      setTotalQuestionsOverride(compiled, fixture, '120');
      expect(resolveBlueprint).not.toHaveBeenCalled(); // no en cada tecla

      vi.advanceTimersByTime(TEMPLATE_RELOAD_DEBOUNCE_MS);
      fixture.detectChanges();

      expect(resolveBlueprint).toHaveBeenCalledTimes(1);
      expect(resolveBlueprint.mock.calls[0][0]).toMatchObject({ totalQuestionsOverride: 120 });
    });

    /**
     * Audit 2026-08-20 (M8), reproducido en vivo: pedir 30 preguntas repartió
     * 29 ("29 preguntas pedidas en 29 celdas") sin explicación — el docente
     * cree que pidió 30. El redondeo del reparto entre cursos es legítimo;
     * callárselo no.
     */
    it('avisa cuando la plantilla reparte menos preguntas de las pedidas', () => {
      const resolveBlueprint = vi.fn((_payload: ResolveBlueprintPayload) =>
        resolveCon([{ courseId: 'c1', count: 29, difficulty: Difficulty.Medium }])(),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      setTotalQuestionsOverride(compiled, fixture, '30');
      vi.advanceTimersByTime(TEMPLATE_RELOAD_DEBOUNCE_MS);
      fixture.detectChanges();

      const note = compiled.querySelector('[data-testid="template-distribution-note"]');
      expect(note).toBeTruthy();
      expect(note!.textContent).toContain('29');
      expect(note!.textContent).toContain('30');
    });

    it('dice que el total NO se aplica cuando la universidad publica sus propios conteos', () => {
      // UNCP responde 80 tanto si pides 60 como si pides 200: el total no se
      // reparte, se ignora. Culpar al redondeo ahí es una explicación falsa
      // (encontrado en vivo 2026-08-23).
      const resolveBlueprint = vi.fn((_payload: ResolveBlueprintPayload) =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', topicId: 't1', count: 80, difficulty: Difficulty.Hard }],
          weekNumber: null,
          templateId: 'tpl-uncp',
          usedCumulativeFallback: false,
          countsFromTemplate: true,
          effectiveWeekNumber: null,
        }),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      setTotalQuestionsOverride(compiled, fixture, '60');
      vi.advanceTimersByTime(TEMPLATE_RELOAD_DEBOUNCE_MS);
      fixture.detectChanges();

      const note = compiled.querySelector('[data-testid="template-distribution-note"]');
      expect(note!.textContent).toContain('publica cuántas preguntas van por curso');
      expect(note!.textContent).toContain('no se aplica');
      // La explicación de redondeo NO debe aparecer en este caso.
      expect(note!.textContent).not.toContain('no da un número exacto');
    });

    it('no muestra la nota de reparto cuando la plantilla reparte exactamente lo pedido', () => {
      const resolveBlueprint = vi.fn((_payload: ResolveBlueprintPayload) =>
        resolveCon([{ courseId: 'c1', count: 30, difficulty: Difficulty.Medium }])(),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      setTotalQuestionsOverride(compiled, fixture, '30');
      vi.advanceTimersByTime(TEMPLATE_RELOAD_DEBOUNCE_MS);
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="template-distribution-note"]')).toBeFalsy();
    });

    it('no muestra la nota de reparto cuando no se pidió una cantidad total', () => {
      const resolveBlueprint = vi.fn((_payload: ResolveBlueprintPayload) =>
        resolveCon([{ courseId: 'c1', count: 29, difficulty: Difficulty.Medium }])(),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');

      expect(compiled.querySelector('[data-testid="template-distribution-note"]')).toBeFalsy();
    });
  });

  describe('tipo de examen — cargar plantilla', () => {
    it('calls resolveBlueprint with the current selections and merges the returned blueprint into the grid', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', topicId: 't1', count: 9, difficulty: Difficulty.Hard }],
          weekNumber: 2,
          templateId: 'tpl-1',
        }),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectGradeLevel(compiled, fixture, 'pre');
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="load-template"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(resolveBlueprint).toHaveBeenCalledWith({ examTypeCode: 'eta', universityId: 'u1' });

      openGrid(compiled, fixture);
      const input = compiled.querySelector<HTMLInputElement>('input[name="requested-c1:t1:hard"]');
      expect(input?.value).toBe('9');
    });

    /**
     * Audit 2026-08-15: la plantilla acierta (UNCP Área II = 80 preguntas en
     * 11 filas) pero el resultado era invisible — esas 11 filas quedaban
     * repartidas dentro de 287 filas / 23,335 px de scroll, sin resumen ni
     * forma de aislarlas. El docente recibía una caja negra que no podía
     * verificar.
     */
    it('resume lo que cargó la plantilla: total de preguntas y cuántas filas', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [
            { courseId: 'c1', topicId: 't1', count: 9, difficulty: Difficulty.Hard },
            { courseId: 'c1', topicId: 't1', count: 6, difficulty: Difficulty.Easy },
          ],
          weekNumber: 2,
          templateId: 'tpl-1',
        }),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectGradeLevel(compiled, fixture, 'pre');
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');

      const summary = compiled.querySelector('[data-testid="template-summary"]');
      expect(summary).toBeTruthy();
      expect(summary!.textContent).toContain('15');
      expect(summary!.textContent).toMatch(/2 celdas/i);
    });

    it('"Ver solo lo pedido" deja únicamente las filas con cantidades, y se puede apagar', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '4');

      const allRows = compiled.querySelectorAll(
        '[data-testid="content-table-desktop"] [data-testid="builder-row"]',
      ).length;
      expect(allRows).toBeGreaterThan(0);

      const toggle = compiled.querySelector(
        '[data-testid="only-requested-toggle"] button',
      ) as HTMLButtonElement;
      toggle.click();
      fixture.detectChanges();

      const filtered = [
        ...compiled.querySelectorAll(
          '[data-testid="content-table-desktop"] [data-testid="builder-row"]',
        ),
      ];
      expect(filtered.length).toBe(1);
      expect(filtered[0].querySelector('input')!.value).toBe('4');

      (
        compiled.querySelector('[data-testid="only-requested-toggle"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      expect(
        compiled.querySelectorAll(
          '[data-testid="content-table-desktop"] [data-testid="builder-row"]',
        ).length,
      ).toBe(allRows);
    });

    it('no ofrece el filtro cuando todavía no hay ninguna celda pedida', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      expect(compiled.querySelector('[data-testid="only-requested-toggle"]')).toBeFalsy();
    });

    it('shows a clear inline message on a 404 (no template/cycle for that scope) without crashing', () => {
      const resolveBlueprint = vi.fn(() =>
        throwError(() => new HttpErrorResponse({ status: 404 })),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="load-template"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const errorEl = compiled.querySelector('[data-testid="template-error"]');
      expect(errorEl).toBeTruthy();
      expect(errorEl!.textContent).toMatch(/plantilla/i);
    });

    it('merges a resolved whole-course row (no topicId) into the grid as a "Todos los temas" sentinel row', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', count: 15, difficulty: Difficulty.Easy }],
          weekNumber: null,
          templateId: 'tpl-uncp',
        }),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="load-template"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const rows = compiled.querySelectorAll('[data-testid="builder-row"]');
      expect(rows.length).toBe(2); // the pre-existing c1/t1 manual row + the new sentinel row
      const sentinelRow = Array.from(rows).find((row) =>
        row.textContent?.includes('Todos los temas'),
      );
      expect(sentinelRow).toBeTruthy();

      const input = compiled.querySelector<HTMLInputElement>('input[name="requested-c1::easy"]');
      expect(input?.value).toBe('15');
    });

    it('includes totalQuestionsOverride in the resolveBlueprint payload as a number when the field has a value', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({ blueprint: [], weekNumber: null, templateId: null }),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      setTotalQuestionsOverride(compiled, fixture, '20');
      (compiled.querySelector('[data-testid="load-template"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(resolveBlueprint).toHaveBeenCalledWith({
        examTypeCode: 'eta',
        universityId: 'u1',
        totalQuestionsOverride: 20,
      });
    });

    it('omits totalQuestionsOverride from the payload entirely when the field is left empty', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({ blueprint: [], weekNumber: null, templateId: null }),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="load-template"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      // Exact deep-equality: any extra key (e.g. `totalQuestionsOverride`) present
      // on the actual payload would already fail this assertion by itself.
      expect(resolveBlueprint).toHaveBeenCalledWith({ examTypeCode: 'eta', universityId: 'u1' });
    });

    it('shows a distinct inline message on a 400 (missing per-course question count) surfacing the backend guidance, never the 404 message', () => {
      const backendMessage =
        'Esta plantilla no tiene conteo de preguntas por curso — indica un total de preguntas.';
      const resolveBlueprint = vi.fn(() =>
        throwError(
          () => new HttpErrorResponse({ status: 400, error: { message: backendMessage } }),
        ),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="load-template"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const errorEl = compiled.querySelector('[data-testid="template-error"]');
      expect(errorEl).toBeTruthy();
      expect(errorEl!.textContent).toContain(backendMessage);

      const NOT_FOUND_MESSAGE =
        'No hay una plantilla configurada para esta universidad/track todavía.';
      expect(errorEl!.textContent?.trim()).not.toBe(NOT_FOUND_MESSAGE);
    });

    it('falls back to a clear Spanish message about filling the total-questions field on a 400 with no backend message body', () => {
      const resolveBlueprint = vi.fn(() =>
        throwError(() => new HttpErrorResponse({ status: 400 })),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="load-template"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const errorEl = compiled.querySelector('[data-testid="template-error"]');
      expect(errorEl).toBeTruthy();
      expect(errorEl!.textContent).toMatch(/cantidad total de preguntas/i);

      const NOT_FOUND_MESSAGE =
        'No hay una plantilla configurada para esta universidad/track todavía.';
      expect(errorEl!.textContent?.trim()).not.toBe(NOT_FOUND_MESSAGE);
    });

    it('auto-loads the template when the selected university has no tracks, without clicking the button', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', topicId: 't1', count: 9, difficulty: Difficulty.Hard }],
          weekNumber: null,
          templateId: 'tpl-1',
        }),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectGradeLevel(compiled, fixture, 'pre');
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');

      expect(resolveBlueprint).toHaveBeenCalledWith({ examTypeCode: 'eta', universityId: 'u1' });
      openGrid(compiled, fixture);
      const input = compiled.querySelector<HTMLInputElement>('input[name="requested-c1:t1:hard"]');
      expect(input?.value).toBe('9');
    });

    it('auto-loads the template when a track is selected, without clicking the button', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', topicId: 't1', count: 7, difficulty: Difficulty.Easy }],
          weekNumber: null,
          templateId: 'tpl-2',
        }),
      );
      const { compiled, fixture } = setup({
        resolveBlueprint,
        getUniversityTracks: () => of(TRACKS),
      });

      selectGradeLevel(compiled, fixture, 'pre');
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');

      expect(resolveBlueprint).not.toHaveBeenCalled();

      selectFromUiSelect(compiled, fixture, 'track-select', 'Preuniversitario');

      expect(resolveBlueprint).toHaveBeenCalledWith({
        examTypeCode: 'eta',
        universityId: 'u1',
        trackId: 'trk1',
      });
      openGrid(compiled, fixture);
      const input = compiled.querySelector<HTMLInputElement>('input[name="requested-c1:t1:easy"]');
      expect(input?.value).toBe('7');
    });

    it('auto-loads the template scoped to the checked course when a course checkbox is toggled, without clicking the button', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', count: 5, difficulty: Difficulty.Medium }],
          weekNumber: null,
          templateId: 'tpl-3',
        }),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectGradeLevel(compiled, fixture, 'pre');
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Fastest');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');

      resolveBlueprint.mockClear();
      (compiled.querySelector('[data-testid="course-checkbox-c1"]') as HTMLInputElement).click();
      fixture.detectChanges();

      expect(resolveBlueprint).toHaveBeenCalledWith({
        examTypeCode: 'fastest',
        universityId: 'u1',
        selectedCourseIds: ['c1'],
      });
      const input = compiled.querySelector<HTMLInputElement>('input[name="requested-c1::medium"]');
      expect(input?.value).toBe('5');
    });

    it('does NOT auto-load when a stale (delayed) empty-tracks response arrives after the university selection has changed', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', topicId: 't1', count: 5, difficulty: Difficulty.Medium }],
          weekNumber: 1,
          templateId: 'tpl-2',
        }),
      );
      // Use multiple universities to properly test the race condition
      const multipleUniversities: University[] = [
        { id: 'u1', code: 'uni', name: 'UNI' },
        { id: 'u2', code: 'uni2', name: 'UNI 2' },
      ];
      // Return empty for any university, but control response timing per call
      let callCount = 0;
      const firstCallSubject = new Subject<Track[]>();
      const secondCallSubject = new Subject<Track[]>();
      const getUniversityTracks = vi.fn((_universityId: string) => {
        callCount++;
        return callCount === 1 ? firstCallSubject.asObservable() : secondCallSubject.asObservable();
      });
      const { compiled, fixture } = setup({
        resolveBlueprint,
        getUniversities: () => of(multipleUniversities),
        getUniversityTracks,
      });

      selectGradeLevel(compiled, fixture, 'pre');
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      // getUniversityTracks('u1') called once, response pending via firstCallSubject

      // User quickly changes university selection before first response resolves
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI 2');
      // Now selectedUniversityId is 'u2', and getUniversityTracks('u2') called, response pending via secondCallSubject

      // Emit the FIRST response (now stale because university changed to u2)
      firstCallSubject.next([]);
      firstCallSubject.complete();
      fixture.detectChanges();

      // resolveBlueprint should NOT have been called for the stale response (first call was for u1, but current selection is u2)
      expect(resolveBlueprint).not.toHaveBeenCalled();
    });

    it("leaves a course's previously-loaded rows in the grid when its checkbox is unchecked afterward (additive merge is accepted behavior — see design doc §4)", () => {
      const courses: Course[] = [
        { id: 'c1', name: 'Matemática', stage: 'preuniversitario' },
        { id: 'c2', name: 'Comunicación', stage: 'preuniversitario' },
      ];
      const resolveBlueprint = vi.fn((payload: { selectedCourseIds?: string[] }) => {
        const ids = payload.selectedCourseIds ?? [];
        const blueprint = [
          ...(ids.includes('c1')
            ? [{ courseId: 'c1', count: 5, difficulty: Difficulty.Medium }]
            : []),
          ...(ids.includes('c2')
            ? [{ courseId: 'c2', count: 8, difficulty: Difficulty.Medium }]
            : []),
        ];
        return of<ResolveBlueprintResult>({ blueprint, weekNumber: null, templateId: 'tpl-3' });
      });
      const { compiled, fixture } = setup({
        getCourses: () => of(courses),
        resolveBlueprint,
        getUniversityTracks: () => of([]),
      });

      selectGradeLevel(compiled, fixture, 'pre');
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Fastest');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');

      (compiled.querySelector('[data-testid="course-checkbox-c1"]') as HTMLInputElement).click();
      fixture.detectChanges();
      (compiled.querySelector('[data-testid="course-checkbox-c2"]') as HTMLInputElement).click();
      fixture.detectChanges();

      // Uncheck c2 — the auto-load re-fires scoped to just c1, but the
      // grid must still show c2's previously-loaded row.
      (compiled.querySelector('[data-testid="course-checkbox-c2"]') as HTMLInputElement).click();
      fixture.detectChanges();

      const c2Input = compiled.querySelector<HTMLInputElement>(
        'input[name="requested-c2::medium"]',
      );
      expect(c2Input?.value).toBe('8');
    });
  });

  describe('tipo de examen — "Cargar plantilla" explains why it is disabled (reported bug: dead silent button)', () => {
    it('disables the button and shows a hint asking for a university right after picking a non-manual exam type', () => {
      const { compiled, fixture } = setup();

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Fastest');

      const button = compiled.querySelector<HTMLButtonElement>(
        '[data-testid="load-template"] button',
      )!;
      expect(button.disabled).toBe(true);
      const hint = compiled.querySelector('[data-testid="load-template-hint"]');
      expect(hint).toBeTruthy();
      expect(hint!.textContent).toMatch(/universidad/i);
    });

    it('disables the button and shows a hint naming the field (Área/Ciclo) once the university has tracks but none is chosen yet', () => {
      const { compiled, fixture } = setup({ getUniversityTracks: () => of(TRACKS) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      fixture.detectChanges();

      const button = compiled.querySelector<HTMLButtonElement>(
        '[data-testid="load-template"] button',
      )!;
      expect(button.disabled).toBe(true);
      const hint = compiled.querySelector('[data-testid="load-template-hint"]');
      expect(hint).toBeTruthy();
      expect(hint!.textContent).toMatch(/ciclo|área/i);
    });

    it('disables the button and shows a hint asking for at least one course for a "selected" course-scope type (fastest) once university is chosen', () => {
      const { compiled, fixture } = setup({ getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Fastest');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      fixture.detectChanges();

      const button = compiled.querySelector<HTMLButtonElement>(
        '[data-testid="load-template"] button',
      )!;
      expect(button.disabled).toBe(true);
      const hint = compiled.querySelector('[data-testid="load-template-hint"]');
      expect(hint).toBeTruthy();
      expect(hint!.textContent).toMatch(/curso/i);
    });

    it('enables the button and hides the hint once every precondition for the selected exam type is met', () => {
      const { compiled, fixture } = setup({ getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      fixture.detectChanges();

      const button = compiled.querySelector<HTMLButtonElement>(
        '[data-testid="load-template"] button',
      )!;
      expect(button.disabled).toBe(false);
      expect(compiled.querySelector('[data-testid="load-template-hint"]')).toBeFalsy();
    });

    it('enables the button for "fastest" once a university (with no tracks) and at least one course are chosen', () => {
      const { compiled, fixture } = setup({ getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Fastest');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="course-checkbox-c1"]') as HTMLInputElement).click();
      fixture.detectChanges();

      const button = compiled.querySelector<HTMLButtonElement>(
        '[data-testid="load-template"] button',
      )!;
      expect(button.disabled).toBe(false);
      expect(compiled.querySelector('[data-testid="load-template-hint"]')).toBeFalsy();
    });
  });

  describe('"Rápido (semana actual)" past the loaded syllabus — the P0 fix (docs/audit-2026-08-14.md)', () => {
    it('shows a warning hint when resolveBlueprint reports usedCumulativeFallback, so the teacher knows the exam is NOT scoped to just this week', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', topicId: 't1', count: 5, difficulty: Difficulty.Medium }],
          weekNumber: 23,
          templateId: 'tpl-1',
          usedCumulativeFallback: true,
          effectiveWeekNumber: 20,
        }),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Fastest');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="course-checkbox-c1"]') as HTMLInputElement).click();
      fixture.detectChanges();

      const hint = compiled.querySelector('[data-testid="cumulative-fallback-hint"]');
      expect(hint).toBeTruthy();
      expect(hint!.textContent).toMatch(/acumulativ/i);
    });

    it('names the last week WITH syllabus content in the hint (effectiveWeekNumber), not the calendar week nobody taught', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', topicId: 't1', count: 5, difficulty: Difficulty.Medium }],
          weekNumber: 23,
          templateId: 'tpl-1',
          usedCumulativeFallback: true,
          effectiveWeekNumber: 20,
        }),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Fastest');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="course-checkbox-c1"]') as HTMLInputElement).click();
      fixture.detectChanges();

      const hint = compiled.querySelector('[data-testid="cumulative-fallback-hint"]');
      expect(hint!.textContent).toMatch(/semana 20/);
      expect(hint!.textContent).not.toMatch(/semana 23/);
    });

    it('does NOT show the warning hint when usedCumulativeFallback is false (normal current-week match)', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', topicId: 't1', count: 5, difficulty: Difficulty.Medium }],
          weekNumber: 3,
          templateId: 'tpl-1',
          usedCumulativeFallback: false,
          effectiveWeekNumber: 3,
        }),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Fastest');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="course-checkbox-c1"]') as HTMLInputElement).click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="cumulative-fallback-hint"]')).toBeFalsy();
    });

    it('does NOT show the warning hint when the field is absent from the response (older/default mock shape)', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', topicId: 't1', count: 5, difficulty: Difficulty.Medium }],
          weekNumber: 3,
          templateId: 'tpl-1',
        }),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Fastest');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="course-checkbox-c1"]') as HTMLInputElement).click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="cumulative-fallback-hint"]')).toBeFalsy();
    });

    it('clears a previous fallback warning once a fresh exam type selection is made', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', topicId: 't1', count: 5, difficulty: Difficulty.Medium }],
          weekNumber: 23,
          templateId: 'tpl-1',
          usedCumulativeFallback: true,
          effectiveWeekNumber: 20,
        }),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Fastest');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="course-checkbox-c1"]') as HTMLInputElement).click();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="cumulative-fallback-hint"]')).toBeTruthy();

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Manual');
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="cumulative-fallback-hint"]')).toBeFalsy();
    });
  });

  describe('tipo de examen — templateCourses catalog (Bug 1 & 2)', () => {
    it('fetches templateCourses filtered to the preuniversitario grade level for an "all" course-scope exam type (eta), not just "selected" scope', () => {
      const { compiled, fixture, getCourses } = setup();

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');

      expect(getCourses).toHaveBeenCalledWith('pre');
    });

    it('resolves the real course name from templateCourses (not the raw UUID) for a whole-course row merged right after the exam type auto-selects preuniversitario', () => {
      const getCourses = vi.fn((gradeLevel?: string) =>
        gradeLevel === 'pre'
          ? of<Course[]>([{ id: 'course-uuid-1', name: 'Aritmética', stage: 'preuniversitario' }])
          : of(COURSES),
      );
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'course-uuid-1', count: 5, difficulty: Difficulty.Easy }],
          weekNumber: null,
          templateId: 'tpl-uncp',
        }),
      );
      const { compiled, fixture } = setup({
        getCourses,
        resolveBlueprint,
        getUniversityTracks: () => of([]),
      });

      // No manual grade-level step needed — selecting ETA already derived
      // grade level to 'pre' and pre-warmed `courses()`/`templateCourses()`.
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="load-template"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const headers = compiled.querySelectorAll('[data-testid="course-group-header"]');
      const header = Array.from(headers).find((h) => h.textContent?.includes('Aritmética'));
      expect(header).toBeTruthy();
      expect(
        compiled.querySelector('[data-testid="content-table-desktop"]')!.textContent,
      ).not.toContain('course-uuid-1');
    });
  });

  describe('whole-course sentinel row stock (Bug 3 — "Todos los temas" rows must resolve real stock, not "solo 0")', () => {
    it('never sends a literal empty-string topicId in the stockBatch payload for a sentinel row (grade level selected before loading the template)', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', count: 15, difficulty: Difficulty.Easy }],
          weekNumber: null,
          templateId: 'tpl-uncp',
        }),
      );
      const stockBatch = vi.fn((_payload: unknown) => of<StockBatchResult>({ results: [] }));
      const { compiled, fixture } = setup({
        resolveBlueprint,
        stockBatch,
        getUniversityTracks: () => of([]),
      });

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      stockBatch.mockClear();
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="load-template"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(stockBatch).toHaveBeenCalled();
      const lastPayload = stockBatch.mock.calls[stockBatch.mock.calls.length - 1][0] as {
        cells: { courseId: string; topicId?: string }[];
      };
      expect(lastPayload.cells.some((cell) => cell.topicId === '')).toBe(false);
      expect(
        lastPayload.cells.some((cell) => cell.courseId === 'c1' && cell.topicId === undefined),
      ).toBe(true);
    });

    it('renders real available stock (not "solo 0") for a whole-course sentinel row when a different grade level was manually selected before switching to a non-manual exam type (overridden to preuniversitario)', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', count: 5, difficulty: Difficulty.Easy }],
          weekNumber: null,
          templateId: 'tpl-uncp',
        }),
      );
      const stockBatch = vi.fn(
        (payload: { cells: { courseId: string; topicId?: string; difficulty: Difficulty }[] }) =>
          of<StockBatchResult>({
            results: payload.cells.map((cell) => ({
              courseId: cell.courseId,
              topicId: cell.topicId,
              difficulty: cell.difficulty,
              available: cell.topicId === undefined && cell.courseId === 'c1' ? 30 : 18,
            })),
          }),
      );
      const { compiled, fixture } = setup({
        resolveBlueprint,
        stockBatch,
        getUniversityTracks: () => of([]),
      });

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="load-template"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      openGrid(compiled, fixture);
      const cell = compiled.querySelector('[data-cell-key="c1::easy"]')!;
      expect(cell.textContent).toContain('de 30');
    });

    it('renders real available stock for a whole-course sentinel row immediately after loading the template, with no grade level selected beforehand (auto-derived to preuniversitario by the exam type itself)', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', count: 5, difficulty: Difficulty.Easy }],
          weekNumber: null,
          templateId: 'tpl-uncp',
        }),
      );
      const stockBatch = vi.fn(
        (payload: { cells: { courseId: string; topicId?: string; difficulty: Difficulty }[] }) =>
          of<StockBatchResult>({
            results: payload.cells.map((cell) => ({
              courseId: cell.courseId,
              topicId: cell.topicId,
              difficulty: cell.difficulty,
              available: cell.topicId === undefined && cell.courseId === 'c1' ? 30 : 18,
            })),
          }),
      );
      const { compiled, fixture } = setup({
        resolveBlueprint,
        stockBatch,
        getUniversityTracks: () => of([]),
      });

      // Grade level was never touched by the user — selecting ETA already
      // auto-derived it to 'pre' (there's no more "before any grade level is
      // selected" state reachable once a non-manual exam type is active).
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="load-template"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      openGrid(compiled, fixture);
      const cell = compiled.querySelector('[data-cell-key="c1::easy"]')!;
      expect(cell.textContent).toContain('de 30');
    });
  });

  describe('toApiTopicId (shared sentinel<->undefined translation, Bug 3a)', () => {
    it('converts the sentinel empty string into undefined', () => {
      expect(toApiTopicId('')).toBeUndefined();
    });

    it('keeps a real topicId untouched', () => {
      expect(toApiTopicId('t1')).toBe('t1');
    });
  });

  describe('sentinel topicId round-trip (critical — POST /exams payload, design doc §3.11)', () => {
    it('strips the store\'s sentinel topicId "" back to an omitted topicId when building a CreateExamBlueprintRow', () => {
      const key = buildCellKey('c1', '', Difficulty.Easy);

      const row = toCreateExamBlueprintRow(key, 12);

      expect(row.topicId).toBeUndefined();
      expect(row).not.toHaveProperty('topicId');
      expect(row).toEqual({ courseId: 'c1', difficulty: Difficulty.Easy, count: 12 });
    });

    it('keeps a real topicId untouched for a normal (non-sentinel) cell', () => {
      const key = buildCellKey('c1', 't1', Difficulty.Easy);

      const row = toCreateExamBlueprintRow(key, 6);

      expect(row.topicId).toBe('t1');
      expect(row).toEqual({ courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, count: 6 });
    });
  });
});
