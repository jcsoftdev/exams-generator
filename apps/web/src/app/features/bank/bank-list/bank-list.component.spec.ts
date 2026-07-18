import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { Router } from '@angular/router';
import {
  LucideAngularModule,
  Lock,
  Pencil,
  Archive,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
} from 'lucide-angular';
import { Difficulty } from '@exams-generator/shared';
import { BankListComponent } from './bank-list.component';
import { BankService } from '../bank.service';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { BankQuestion } from '../bank.models';
import { Course, Topic } from '../../taxonomy/taxonomy.models';

function makeQuestion(o: Partial<BankQuestion> & { id: string }): BankQuestion {
  return {
    id: o.id,
    tenantId: o.tenantId ?? 't1',
    courseId: o.courseId ?? 'c1',
    topicId: o.topicId ?? 't1',
    difficulty: o.difficulty ?? Difficulty.Easy,
    gradeLevel: o.gradeLevel ?? 'pre',
    correctAnswer: o.correctAnswer ?? 'a',
    imageAssetId: o.imageAssetId ?? null,
    status: o.status ?? 'approved',
    type: o.type ?? 'image',
    origin: o.origin ?? 'school',
    usedInExamCount: o.usedInExamCount ?? 0,
  };
}

const COURSES: Course[] = [
  { id: 'c1', name: 'Aritmética' },
  { id: 'c2', name: 'Álgebra' },
];
const TOPICS_C1: Topic[] = [
  { id: 't1', name: 'Fracciones', courseId: 'c1' },
  { id: 't2', name: 'Porcentajes', courseId: 'c1' },
];
const TOPICS_C2: Topic[] = [{ id: 't3', name: 'Ecuaciones', courseId: 'c2' }];

const QUESTIONS: BankQuestion[] = [
  makeQuestion({ id: 'q1', courseId: 'c1', topicId: 't1', imageAssetId: 'asset-1' }),
  makeQuestion({ id: 'q2', courseId: 'c1', topicId: 't1', difficulty: Difficulty.Medium }),
  makeQuestion({ id: 'q3', courseId: 'c1', topicId: 't2', difficulty: Difficulty.Hard }),
  makeQuestion({ id: 'q4', courseId: 'c2', topicId: 't3' }),
];

function setup(
  over: {
    listImpl?: (...a: unknown[]) => unknown;
    getQuestionImpl?: (id: string) => unknown;
    archiveImpl?: (id: string) => unknown;
    deleteImpl?: (id: string) => unknown;
    getCoursesImpl?: () => unknown;
    getTopicsImpl?: (courseId: string) => unknown;
  } = {},
) {
  const listQuestions = vi.fn(over.listImpl ?? (() => of(QUESTIONS)));
  const getQuestion = vi.fn(over.getQuestionImpl ?? ((id: string) => of(makeQuestion({ id }))));
  const archiveQuestion = vi.fn(over.archiveImpl ?? ((id: string) => of({ id, status: 'archived' })));
  const deleteQuestion = vi.fn(over.deleteImpl ?? (() => of(void 0)));
  const buildImageAssetUrl = vi.fn((id: string) => `http://api.test/assets/${id}`);
  const fetchQuestionImage = vi.fn((id: string) => of(new Blob([`b-${id}`], { type: 'image/png' })));
  const getCourses = vi.fn(over.getCoursesImpl ?? (() => of(COURSES)));
  const getTopics = vi.fn(
    over.getTopicsImpl ?? ((courseId: string) => of(courseId === 'c1' ? TOPICS_C1 : TOPICS_C2)),
  );
  const navigate = vi.fn();
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-${n++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  TestBed.configureTestingModule({
    imports: [BankListComponent],
    providers: [
      importProvidersFrom(
        LucideAngularModule.pick({
          Lock,
          Pencil,
          Archive,
          Trash2,
          Search,
          ChevronLeft,
          ChevronRight,
          ChevronDown,
        }),
      ),
      {
        provide: BankService,
        useValue: {
          listQuestions,
          getQuestion,
          archiveQuestion,
          deleteQuestion,
          buildImageAssetUrl,
          fetchQuestionImage,
        },
      },
      { provide: TaxonomyService, useValue: { getCourses, getTopics } },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const fixture = TestBed.createComponent(BankListComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    listQuestions,
    getQuestion,
    archiveQuestion,
    deleteQuestion,
    fetchQuestionImage,
    getCourses,
    getTopics,
    navigate,
  };
}

function courseHeader(compiled: HTMLElement, courseId: string): HTMLElement {
  return compiled.querySelector(`[data-testid="course-header"][data-course-id="${courseId}"]`) as HTMLElement;
}

function topicHeader(compiled: HTMLElement, topicId: string): HTMLElement {
  return compiled.querySelector(`[data-testid="topic-header"][data-topic-id="${topicId}"]`) as HTMLElement;
}

function expandTopic(compiled: HTMLElement, fixture: { detectChanges(): void }, topicId: string): void {
  topicHeader(compiled, topicId).click();
  fixture.detectChanges();
}

describe('BankListComponent', () => {
  describe('tree structure', () => {
    it('groups questions by course -> topic with resolved names and counts, never raw UUIDs', () => {
      const { compiled } = setup();
      const headers = compiled.querySelectorAll('[data-testid="course-header"]');
      expect(headers.length).toBe(2);
      expect(courseHeader(compiled, 'c1').textContent).toMatch(/Aritmética/);
      expect(courseHeader(compiled, 'c1').textContent).toMatch(/3/);
      expect(courseHeader(compiled, 'c2').textContent).toMatch(/Álgebra/);
      expect(compiled.textContent).not.toMatch(/\bc1\b/);
      expect(compiled.textContent).not.toMatch(/\bc2\b/);
      expect(compiled.textContent).not.toMatch(/\bt1\b/);
    });

    it('topics are collapsed by default — no question leaves render until a topic is expanded', () => {
      const { compiled } = setup();
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(0);
      expect(topicHeader(compiled, 't1')).toBeTruthy();
    });

    it('expanding a topic reveals its questions with clave and a difficulty tag', () => {
      const { compiled, fixture } = setup();
      expandTopic(compiled, fixture, 't1');
      const leaves = compiled.querySelectorAll('[data-testid="bank-question"]');
      expect(leaves.length).toBe(2);
      expect(leaves[0].textContent).toMatch(/Clave: a/);
      expect(leaves[0].querySelector('[data-testid="tag"]')).toBeTruthy();
    });

    it('collapsing a course hides its topics and their expanded questions', () => {
      const { compiled, fixture } = setup();
      expandTopic(compiled, fixture, 't1');
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(2);

      courseHeader(compiled, 'c1').click();
      fixture.detectChanges();
      expect(topicHeader(compiled, 't1')).toBeFalsy();
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(0);
    });

    it('reflects expand/collapse state via aria-expanded on headers', () => {
      const { compiled, fixture } = setup();
      expect(courseHeader(compiled, 'c1').getAttribute('aria-expanded')).toBe('true');
      expect(topicHeader(compiled, 't1').getAttribute('aria-expanded')).toBe('false');

      expandTopic(compiled, fixture, 't1');
      expect(topicHeader(compiled, 't1').getAttribute('aria-expanded')).toBe('true');
    });

    it('fetches thumbnails through an authenticated blob for a leaf question', () => {
      const { compiled, fixture, fetchQuestionImage } = setup();
      expandTopic(compiled, fixture, 't1');
      expect(fetchQuestionImage).toHaveBeenCalledWith('asset-1');
      expect(compiled.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
    });
  });

  describe('detail panel', () => {
    it('opens the detail panel with actions when a leaf question is selected', () => {
      const { compiled, fixture, getQuestion } = setup();
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="bank-panel"]')).toBeTruthy();
      expect(getQuestion).toHaveBeenCalledWith('q1');
      expect(compiled.querySelector('[data-testid="panel-archive"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="panel-delete"]')).toBeFalsy();
    });

    it('shows delete (not archive) for an own draft', () => {
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) => of(makeQuestion({ id, status: 'draft' })),
      });
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="panel-delete"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="panel-archive"]')).toBeFalsy();
    });

    it('renders central-bank questions read-only (lock note, no actions)', () => {
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) => of(makeQuestion({ id, tenantId: null, origin: 'central' })),
      });
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="panel-readonly"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="panel-archive"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="panel-delete"]')).toBeFalsy();
    });

    it('archives the selected approved question and reloads the tree', () => {
      const { compiled, fixture, archiveQuestion, listQuestions } = setup();
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();
      listQuestions.mockClear();
      (compiled.querySelector('[data-testid="panel-archive"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(archiveQuestion).toHaveBeenCalledWith('q1');
      expect(listQuestions).toHaveBeenCalledTimes(1);
    });
  });

  describe('filters', () => {
    it('re-fetches questions with the selected nivel (difficulty) filter on Buscar', () => {
      const { fixture, listQuestions } = setup();
      listQuestions.mockClear();
      (fixture.componentInstance as unknown as { difficulty: { set(v: Difficulty): void } }).difficulty.set(
        Difficulty.Hard,
      );
      (fixture.componentInstance as unknown as { search(): void }).search();
      fixture.detectChanges();
      expect(listQuestions).toHaveBeenCalledWith(expect.objectContaining({ difficulty: Difficulty.Hard }));
    });
  });

  describe('loading', () => {
    it('shows a loading indicator while the initial fetch is pending and no stale tree', () => {
      const subject = new Subject<BankQuestion[]>();
      const { compiled, fixture } = setup({ listImpl: () => subject.asObservable() });
      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeTruthy();
      subject.next(QUESTIONS);
      subject.complete();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeFalsy();
      expect(compiled.querySelectorAll('[data-testid="course-header"]').length).toBe(2);
    });
  });

  describe('empty states', () => {
    it('shows "banco vacío" with CTA when the bank has zero questions overall', () => {
      const { compiled } = setup({ listImpl: () => of([]) });
      expect(compiled.querySelector('[data-testid="empty-bank"]')).toBeTruthy();
      expect(compiled.textContent).toMatch(/banco vacío/i);
    });

    it('shows "sin resultados" when filters match none but bank is non-empty', () => {
      const listImpl = vi.fn().mockReturnValueOnce(of(QUESTIONS)).mockReturnValueOnce(of([]));
      const { compiled, fixture } = setup({ listImpl });
      (fixture.componentInstance as unknown as { difficulty: { set(v: Difficulty): void } }).difficulty.set(
        Difficulty.Hard,
      );
      (fixture.componentInstance as unknown as { search(): void }).search();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="empty-no-results"]')).toBeTruthy();
      expect(compiled.textContent).toMatch(/sin resultados|esos filtros/i);
    });
  });

  describe('error', () => {
    it('shows an error state with retry that reloads the tree', () => {
      const { compiled, fixture, listQuestions } = setup({
        listImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });
      expect(compiled.querySelector('[data-testid="error-state"]')).toBeTruthy();
      expect(compiled.textContent).toMatch(/no se pudieron cargar/i);
      listQuestions.mockClear();
      listQuestions.mockReturnValue(of(QUESTIONS));
      (compiled.querySelector('[data-testid="retry-button"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(listQuestions).toHaveBeenCalledTimes(1);
      expect(compiled.querySelectorAll('[data-testid="course-header"]').length).toBe(2);
    });
  });
});
