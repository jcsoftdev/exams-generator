import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { describe, it, expect, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { Difficulty } from '@exams-generator/shared';
import { GRADE_LEVEL_LABELS, GradeLevel } from '../exams.models';
import { ExamBuilderComponent, toApiTopicId, toCreateExamBlueprintRow } from './exam-builder.component';
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
  ResolveBlueprintResult,
} from '../exams.models';
import { ExamVersionJob } from '../../exam-versions/exam-versions.models';

const COURSES: Course[] = [{ id: 'c1', name: 'Matemática' }];
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
const TRACKS: Track[] = [{ id: 'trk1', code: 'preuniversitario', name: 'Preuniversitario', kind: 'cycle_track' }];

function setup(overrides: {
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
} = {}) {
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
  const navigate = vi.fn();

  TestBed.configureTestingModule({
    imports: [ExamBuilderComponent],
    providers: [
      { provide: TaxonomyService, useValue: { getCourses, getTopicsForCourses } },
      {
        provide: ExamsService,
        useValue: { stockBatch, previewExam, createExam, getExamTypes, getUniversities, getUniversityTracks, resolveBlueprint },
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

/** Opens a `ui-select` identified by its `data-testid` and clicks the option whose label matches. */
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
    (li) => li.textContent?.trim() === optionLabel,
  ) as HTMLElement | undefined;
  if (!option) {
    throw new Error(`option "${optionLabel}" not found in ui-select "${testId}"`);
  }
  option.click();
  fixture.detectChanges();
}

function selectGradeLevel(compiled: HTMLElement, fixture: { detectChanges: () => void }, value: GradeLevel): void {
  selectFromUiSelect(compiled, fixture, 'grade-level-select', GRADE_LEVEL_LABELS[value]);
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
  fixture.detectChanges();
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
      const { compiled, fixture } = setup({ stockBatch: () => throwError(() => new Error('boom')) });

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      const errorState = compiled.querySelector('[data-testid="error-state"]');
      expect(errorState).toBeTruthy();
      expect(errorState!.textContent).toMatch(/no se pudieron cargar/i);
      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="empty-state-cta"]')).toBeFalsy();
    });

    it('renders an error state when the preview call fails', () => {
      const { compiled, fixture } = setup({ previewExam: () => throwError(() => new Error('boom')) });

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
      (cell.querySelector('[data-testid="bridge-generate-ai"] button') as HTMLButtonElement).click();

      expect(navigate).toHaveBeenCalledWith(['/app/ai/generate'], {
        queryParams: { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Medium, gradeLevel: 'secundaria_1' },
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

      const button = compiled.querySelector<HTMLButtonElement>('[data-testid="generate-versions"] button')!;
      expect(button.disabled).toBe(true);
      expect(compiled.querySelector('[data-testid="lock-reason"]')).toBeTruthy();
    });

    it('unlocks when every requested cell is fully satisfiable', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');

      const button = compiled.querySelector<HTMLButtonElement>('[data-testid="generate-versions"] button')!;
      expect(button.disabled).toBe(false);
      expect(compiled.querySelector('[data-testid="lock-reason"]')).toBeFalsy();
    });
  });

  describe('EB-R5 — editing one cell does not re-roll another cell already previewed', () => {
    it('leaves the easy cell preview untouched when the medium cell is edited afterward, and calls preview with a single-row blueprint per edit', () => {
      const previewExam = vi.fn((payload: { blueprint: { difficulty: Difficulty; count: number }[] }) => {
        const row = payload.blueprint[0];
        const ids =
          row.difficulty === Difficulty.Easy ? ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] : ['q9', 'q10', 'q11', 'q12'];
        return of<PreviewExamResult>({
          selections: [{ rowIndex: 0, courseId: 'c1', topicId: 't1', difficulty: row.difficulty, questionIds: ids }],
          shortages: [],
        });
      });
      const { compiled, fixture } = setup({ previewExam });

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');

      const easyCellBefore = compiled.querySelector('[data-testid="preview-ids"][data-cell-key="c1:t1:easy"]')!.textContent;
      expect(easyCellBefore).toContain('q1');

      previewExam.mockClear();
      setCellCount(compiled, fixture, 'c1:t1:medium', '4');

      expect(previewExam).toHaveBeenCalledTimes(1);
      const secondCallPayload = previewExam.mock.calls[0][0] as { blueprint: { difficulty: Difficulty }[] };
      expect(secondCallPayload.blueprint).toHaveLength(1);
      expect(secondCallPayload.blueprint[0].difficulty).toBe(Difficulty.Medium);

      const easyCellAfter = compiled.querySelector('[data-testid="preview-ids"][data-cell-key="c1:t1:easy"]')!.textContent;
      expect(easyCellAfter).toBe(easyCellBefore);
      const mediumCellAfter = compiled.querySelector('[data-testid="preview-ids"][data-cell-key="c1:t1:medium"]')!.textContent;
      expect(mediumCellAfter).toContain('q9');
    });
  });

  describe('responsive (EB-R7)', () => {
    it('renders stacked per-topic cards for mobile (md:hidden) and the table for desktop (hidden md:block), preview after the cards on mobile', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      const mobile = compiled.querySelector('[data-testid="content-cards-mobile"]')!;
      const desktop = compiled.querySelector('[data-testid="content-table-desktop"]')!;
      expect(mobile.className).toContain('md:hidden');
      expect(desktop.className).toContain('hidden');
      expect(desktop.className).toContain('md:block');

      const card = mobile.querySelector('[data-testid="builder-card"]');
      expect(card).toBeTruthy();

      const cardsIndex = Array.from(mobile.children).findIndex((el) => el === card);
      const previewPanel = mobile.querySelector('[data-testid="preview-panel"]');
      expect(previewPanel).toBeTruthy();
      const previewIndex = Array.from(mobile.children).indexOf(previewPanel as Element);
      expect(previewIndex).toBeGreaterThan(cardsIndex);
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
        { id: 'c1', name: 'Matemática' },
        { id: 'c2', name: 'Comunicación' },
      ];
      const topicsByCourse: Record<string, Topic[]> = {
        c1: [{ id: 't1', name: 'Álgebra', courseId: 'c1' }],
        c2: [{ id: 't2', name: 'Lectura', courseId: 'c2' }],
      };
      const { compiled, fixture, getTopicsForCourses } = setup({
        getCourses: () => of(courses),
        getTopicsForCourses: (courseIds: string[]) => of(courseIds.flatMap((id) => topicsByCourse[id] ?? [])),
      });

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      expect(getTopicsForCourses).toHaveBeenCalledTimes(1);
      expect(getTopicsForCourses).toHaveBeenCalledWith(['c1', 'c2'], 'secundaria_1');
    });

    it('renders a course subheading row before each course\'s topics when the grid spans multiple courses', () => {
      const courses: Course[] = [
        { id: 'c1', name: 'Matemática' },
        { id: 'c2', name: 'Comunicación' },
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
        getTopicsForCourses: (courseIds: string[]) => of(courseIds.flatMap((id) => topicsByCourse[id] ?? [])),
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
        { id: 'c1', name: 'Matemática' },
        { id: 'c2', name: 'Comunicación' },
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
        getTopicsForCourses: (courseIds: string[]) => of(courseIds.flatMap((id) => topicsByCourse[id] ?? [])),
        stockBatch: () => of(stock),
      });

      selectGradeLevel(compiled, fixture, 'secundaria_1');

      const desktop = compiled.querySelector('[data-testid="content-table-desktop"]')!;
      expect(desktop.querySelectorAll('[data-testid="builder-row"]').length).toBe(2);

      const firstHeader = desktop.querySelector('[data-testid="course-group-header"]') as HTMLElement;
      firstHeader.click();
      fixture.detectChanges();

      const rows = desktop.querySelectorAll('[data-testid="builder-row"]');
      expect(rows.length).toBe(1);
      expect(rows[0].textContent).toContain('Lectura');
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

    it('merges a template-loaded whole-course sentinel row into the SAME course header as that course\'s pre-existing (non-consecutive) topic rows, not a duplicate header', () => {
      // Reproduces the real bug: the grade-level grid populates real topic
      // rows for BOTH courses first — [c1/t1, c2/t2] — then
      // `bulkLoadFromBlueprint` APPENDS the resolved whole-course sentinel
      // row for c1 at the END of `store.rows()`: [c1/t1, c2/t2, c1/""].
      // c1's two rows are no longer consecutive (c2's row sits between
      // them). A consecutive-run group-by would wrongly split c1 into two
      // separate `course-group-header`s sharing one `courseId`, which
      // duplicates the `@for`'s `track group.courseId` key (NG0955).
      const courses: Course[] = [
        { id: 'c1', name: 'Matemática' },
        { id: 'c2', name: 'Comunicación' },
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
        getTopicsForCourses: (courseIds: string[]) => of(courseIds.flatMap((id) => topicsByCourse[id] ?? [])),
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
    it('creates the exam, generates versions, and navigates to the versions screen', () => {
      const { compiled, fixture, createExam, generateVersions, navigate } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      setCellCount(compiled, fixture, 'c1:t1:easy', '6');

      const button = compiled.querySelector<HTMLButtonElement>('[data-testid="generate-versions"] button')!;
      button.click();
      fixture.detectChanges();

      expect(createExam).toHaveBeenCalled();
      expect(generateVersions).toHaveBeenCalledWith('exam-1', expect.any(Number));
      expect(navigate).toHaveBeenCalledWith(['/app/exams', 'exam-1', 'versions']);
    });
  });

  describe('tipo de examen — manual default invariant (critical: zero behavior change from today)', () => {
    it('defaults the exam type to manual and hides every template affordance, without ever calling getUniversities', () => {
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

      const button = compiled.querySelector<HTMLButtonElement>('[data-testid="generate-versions"] button')!;
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
      // The grid is ready without the user ever touching a grade selector.
      expect(getCourses).toHaveBeenCalledWith('pre');
      expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeTruthy();
    });

    it('overrides an already-selected different grade level to preuniversitario when switching to a non-manual exam type', () => {
      const { compiled, fixture } = setup();

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');

      expect(compiled.querySelector('[data-testid="grade-level-select"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="grade-level-derived"]')!.textContent).toContain('Pre-admisión');
      // Old grade's rows were replaced, not duplicated alongside the new ones.
      expect(compiled.querySelectorAll('[data-testid="builder-row"]').length).toBe(1);
    });

    it('does not rebuild or duplicate the grid when switching between two different non-manual exam types (already preuniversitario)', () => {
      const { compiled, fixture } = setup();

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Fastest');
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');

      expect(compiled.querySelectorAll('[data-testid="builder-row"]').length).toBe(1);
    });

    it('resets grade level back to null when switching back to manual — selector reappears, derived indicator and grid disappear (EB-T invariant)', () => {
      const { compiled, fixture } = setup();

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeTruthy();

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'Manual');

      expect(compiled.querySelector('[data-testid="grade-level-select"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="grade-level-derived"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="content-table-desktop"]')).toBeFalsy();
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

      const input = compiled.querySelector<HTMLInputElement>('input[name="requested-c1:t1:hard"]');
      expect(input?.value).toBe('9');
    });

    it('shows a clear inline message on a 404 (no template/cycle for that scope) without crashing', () => {
      const resolveBlueprint = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404 })));
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
      const sentinelRow = Array.from(rows).find((row) => row.textContent?.includes('Todos los temas'));
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
      const backendMessage = 'Esta plantilla no tiene conteo de preguntas por curso — indica un total de preguntas.';
      const resolveBlueprint = vi.fn(() =>
        throwError(() => new HttpErrorResponse({ status: 400, error: { message: backendMessage } })),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="load-template"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const errorEl = compiled.querySelector('[data-testid="template-error"]');
      expect(errorEl).toBeTruthy();
      expect(errorEl!.textContent).toContain(backendMessage);

      const NOT_FOUND_MESSAGE = 'No hay una plantilla configurada para esta universidad/track todavía.';
      expect(errorEl!.textContent?.trim()).not.toBe(NOT_FOUND_MESSAGE);
    });

    it('falls back to a clear Spanish message about filling the total-questions field on a 400 with no backend message body', () => {
      const resolveBlueprint = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 400 })));
      const { compiled, fixture } = setup({ resolveBlueprint, getUniversityTracks: () => of([]) });

      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="load-template"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const errorEl = compiled.querySelector('[data-testid="template-error"]');
      expect(errorEl).toBeTruthy();
      expect(errorEl!.textContent).toMatch(/cantidad total de preguntas/i);

      const NOT_FOUND_MESSAGE = 'No hay una plantilla configurada para esta universidad/track todavía.';
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
      const input = compiled.querySelector<HTMLInputElement>('input[name="requested-c1:t1:hard"]');
      expect(input?.value).toBe('9');
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
        gradeLevel === 'pre' ? of<Course[]>([{ id: 'course-uuid-1', name: 'Aritmética' }]) : of(COURSES),
      );
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'course-uuid-1', count: 5, difficulty: Difficulty.Easy }],
          weekNumber: null,
          templateId: 'tpl-uncp',
        }),
      );
      const { compiled, fixture } = setup({ getCourses, resolveBlueprint, getUniversityTracks: () => of([]) });

      // No manual grade-level step needed — selecting ETA already derived
      // grade level to 'pre' and pre-warmed `courses()`/`templateCourses()`.
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="load-template"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const headers = compiled.querySelectorAll('[data-testid="course-group-header"]');
      const header = Array.from(headers).find((h) => h.textContent?.includes('Aritmética'));
      expect(header).toBeTruthy();
      expect(compiled.querySelector('[data-testid="content-table-desktop"]')!.textContent).not.toContain(
        'course-uuid-1',
      );
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
      const { compiled, fixture } = setup({ resolveBlueprint, stockBatch, getUniversityTracks: () => of([]) });

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
      expect(lastPayload.cells.some((cell) => cell.courseId === 'c1' && cell.topicId === undefined)).toBe(true);
    });

    it('renders real available stock (not "solo 0") for a whole-course sentinel row when a different grade level was manually selected before switching to a non-manual exam type (overridden to preuniversitario)', () => {
      const resolveBlueprint = vi.fn(() =>
        of<ResolveBlueprintResult>({
          blueprint: [{ courseId: 'c1', count: 5, difficulty: Difficulty.Easy }],
          weekNumber: null,
          templateId: 'tpl-uncp',
        }),
      );
      const stockBatch = vi.fn((payload: { cells: { courseId: string; topicId?: string; difficulty: Difficulty }[] }) =>
        of<StockBatchResult>({
          results: payload.cells.map((cell) => ({
            courseId: cell.courseId,
            topicId: cell.topicId,
            difficulty: cell.difficulty,
            available: cell.topicId === undefined && cell.courseId === 'c1' ? 30 : 18,
          })),
        }),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, stockBatch, getUniversityTracks: () => of([]) });

      selectGradeLevel(compiled, fixture, 'secundaria_1');
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="load-template"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

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
      const stockBatch = vi.fn((payload: { cells: { courseId: string; topicId?: string; difficulty: Difficulty }[] }) =>
        of<StockBatchResult>({
          results: payload.cells.map((cell) => ({
            courseId: cell.courseId,
            topicId: cell.topicId,
            difficulty: cell.difficulty,
            available: cell.topicId === undefined && cell.courseId === 'c1' ? 30 : 18,
          })),
        }),
      );
      const { compiled, fixture } = setup({ resolveBlueprint, stockBatch, getUniversityTracks: () => of([]) });

      // Grade level was never touched by the user — selecting ETA already
      // auto-derived it to 'pre' (there's no more "before any grade level is
      // selected" state reachable once a non-manual exam type is active).
      selectFromUiSelect(compiled, fixture, 'exam-type-select', 'ETA');
      selectFromUiSelect(compiled, fixture, 'university-select', 'UNI');
      (compiled.querySelector('[data-testid="load-template"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

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
