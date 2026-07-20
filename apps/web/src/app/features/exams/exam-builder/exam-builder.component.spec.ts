import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, it, expect, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { Difficulty } from '@exams-generator/shared';
import { GRADE_LEVEL_LABELS, GradeLevel } from '../exams.models';
import { ExamBuilderComponent } from './exam-builder.component';
import { ExamsService } from '../exams.service';
import { ExamVersionsService } from '../../exam-versions/exam-versions.service';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { StockBatchResult, PreviewExamResult, CreateExamResult } from '../exams.models';
import { GeneratedVersionResult } from '../../exam-versions/exam-versions.models';

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

function setup(overrides: {
  getCourses?(): unknown;
  getTopics?(courseId: string): unknown;
  stockBatch?(payload: unknown): unknown;
  previewExam?(payload: unknown): unknown;
  createExam?(payload: unknown): unknown;
  generateVersions?(...args: unknown[]): unknown;
} = {}) {
  const getCourses = vi.fn(overrides.getCourses ?? (() => of(COURSES)));
  const getTopics = vi.fn(overrides.getTopics ?? (() => of(TOPICS)));
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
    overrides.generateVersions ?? (() => of<GeneratedVersionResult[]>([])),
  );
  const navigate = vi.fn();

  TestBed.configureTestingModule({
    imports: [ExamBuilderComponent],
    providers: [
      { provide: TaxonomyService, useValue: { getCourses, getTopics } },
      { provide: ExamsService, useValue: { stockBatch, previewExam, createExam } },
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
    getTopics,
    stockBatch,
    previewExam,
    createExam,
    generateVersions,
    navigate,
  };
}

function selectGradeLevel(compiled: HTMLElement, fixture: { detectChanges: () => void }, value: GradeLevel): void {
  const container = compiled.querySelector('ui-select') as HTMLElement;
  if (!container) {
    throw new Error('grade level select not found');
  }
  (container.querySelector('button[role="combobox"]') as HTMLButtonElement).click();
  fixture.detectChanges();
  const label = GRADE_LEVEL_LABELS[value];
  const option = Array.from(container.querySelectorAll('[data-testid="select-option"]')).find(
    (li) => li.textContent?.trim() === label,
  ) as HTMLElement | undefined;
  if (!option) {
    throw new Error(`grade level option "${label}" not found`);
  }
  option.click();
  fixture.detectChanges();
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
        getTopics: (courseId: string) => of(topicsByCourse[courseId]),
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
        getTopics: (courseId: string) => of(topicsByCourse[courseId]),
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
});
