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
} from 'lucide-angular';
import { Difficulty } from '@exams-generator/shared';
import { BankListComponent } from './bank-list.component';
import { BankService } from '../bank.service';
import { BankQuestion, PagedQuestions } from '../bank.models';

function makeQuestion(o: Partial<BankQuestion> & { id: string }): BankQuestion {
  return {
    id: o.id,
    tenantId: o.tenantId ?? 't1',
    courseId: o.courseId ?? 'course-1',
    topicId: o.topicId ?? 'topic-1',
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

const TWELVE = Array.from({ length: 12 }, (_, i) =>
  makeQuestion({
    id: `q${i}`,
    difficulty: [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard][i % 3],
    imageAssetId: i === 0 ? 'asset-1' : null,
  }),
);
const PAGE1: PagedQuestions = { items: TWELVE, total: 30 };

function setup(
  over: {
    listImpl?: (...a: unknown[]) => unknown;
    getQuestionImpl?: (id: string) => unknown;
    archiveImpl?: (id: string) => unknown;
    deleteImpl?: (id: string) => unknown;
  } = {},
) {
  const listQuestionsPaged = vi.fn(over.listImpl ?? (() => of(PAGE1)));
  const getQuestion = vi.fn(over.getQuestionImpl ?? ((id: string) => of(makeQuestion({ id }))));
  const archiveQuestion = vi.fn(over.archiveImpl ?? ((id: string) => of({ id, status: 'archived' })));
  const deleteQuestion = vi.fn(over.deleteImpl ?? (() => of(void 0)));
  const buildImageAssetUrl = vi.fn((id: string) => `http://api.test/assets/${id}`);
  const fetchQuestionImage = vi.fn((id: string) => of(new Blob([`b-${id}`], { type: 'image/png' })));
  const navigate = vi.fn();
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-${n++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  TestBed.configureTestingModule({
    imports: [BankListComponent],
    providers: [
      importProvidersFrom(
        LucideAngularModule.pick({ Lock, Pencil, Archive, Trash2, Search, ChevronLeft, ChevronRight }),
      ),
      {
        provide: BankService,
        useValue: { listQuestionsPaged, getQuestion, archiveQuestion, deleteQuestion, buildImageAssetUrl, fetchQuestionImage },
      },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const fixture = TestBed.createComponent(BankListComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    listQuestionsPaged,
    getQuestion,
    archiveQuestion,
    deleteQuestion,
    fetchQuestionImage,
    navigate,
  };
}

function selectFirst(compiled: HTMLElement, fixture: { detectChanges(): void }) {
  (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
  fixture.detectChanges();
}

describe('BankListComponent', () => {
  describe('with-data', () => {
    it('renders the current page of questions with a difficulty tag on each', () => {
      const { compiled } = setup();
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(12);
      expect(compiled.querySelectorAll('[data-testid="tag"]').length).toBe(12);
    });

    it('fetches thumbnails through an authenticated blob', () => {
      const { compiled, fetchQuestionImage } = setup();
      expect(fetchQuestionImage).toHaveBeenCalledWith('asset-1');
      expect(compiled.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
    });
  });

  describe('detail panel', () => {
    it('opens the detail panel with actions when a question is selected', () => {
      const { compiled, fixture, getQuestion } = setup();
      selectFirst(compiled, fixture);
      expect(compiled.querySelector('[data-testid="bank-panel"]')).toBeTruthy();
      expect(getQuestion).toHaveBeenCalledWith('q0');
      expect(compiled.querySelector('[data-testid="panel-archive"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="panel-delete"]')).toBeFalsy(); // approved: no borrar
    });

    it('shows delete (not archive) for an own draft', () => {
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) => of(makeQuestion({ id, status: 'draft' })),
      });
      selectFirst(compiled, fixture);
      expect(compiled.querySelector('[data-testid="panel-delete"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="panel-archive"]')).toBeFalsy();
    });

    it('renders central-bank questions read-only (lock note, no actions)', () => {
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) => of(makeQuestion({ id, tenantId: null, origin: 'central' })),
      });
      selectFirst(compiled, fixture);
      expect(compiled.querySelector('[data-testid="panel-readonly"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="panel-archive"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="panel-delete"]')).toBeFalsy();
    });

    it('archives the selected approved question and reloads the list', () => {
      const { compiled, fixture, archiveQuestion, listQuestionsPaged } = setup();
      selectFirst(compiled, fixture);
      listQuestionsPaged.mockClear();
      (compiled.querySelector('[data-testid="panel-archive"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(archiveQuestion).toHaveBeenCalledWith('q0');
      expect(listQuestionsPaged).toHaveBeenCalledTimes(1);
    });
  });

  describe('pagination', () => {
    it('renders page info and advances to the next page', () => {
      const { compiled, fixture, listQuestionsPaged } = setup();
      expect(compiled.querySelector('[data-testid="bank-pagination"]')?.textContent).toMatch(/30/);
      listQuestionsPaged.mockClear();
      (compiled.querySelector('[data-testid="bank-page-next"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(listQuestionsPaged).toHaveBeenCalledWith(expect.anything(), 2, expect.any(Number));
    });
  });

  describe('loading', () => {
    it('shows a loading indicator while pending and no stale rows', () => {
      const subject = new Subject<PagedQuestions>();
      const { compiled, fixture } = setup({ listImpl: () => subject.asObservable() });
      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeTruthy();
      subject.next(PAGE1);
      subject.complete();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeFalsy();
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(12);
    });
  });

  describe('empty states', () => {
    it('shows "banco vacío" with CTA when the bank has zero questions overall', () => {
      const { compiled } = setup({ listImpl: () => of({ items: [], total: 0 }) });
      expect(compiled.querySelector('[data-testid="empty-bank"]')).toBeTruthy();
      expect(compiled.textContent).toMatch(/banco vacío/i);
    });

    it('shows "sin resultados" when filters match none but bank is non-empty', () => {
      const listImpl = vi.fn().mockReturnValueOnce(of(PAGE1)).mockReturnValueOnce(of({ items: [], total: 0 }));
      const { compiled, fixture } = setup({ listImpl });
      (fixture.componentInstance as unknown as { courseId: { set(v: string): void } }).courseId.set('nope');
      (fixture.componentInstance as unknown as { search(): void }).search();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="empty-no-results"]')).toBeTruthy();
      expect(compiled.textContent).toMatch(/sin resultados|esos filtros/i);
    });
  });

  describe('error', () => {
    it('shows an error state with retry', () => {
      const { compiled, fixture, listQuestionsPaged } = setup({
        listImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });
      expect(compiled.querySelector('[data-testid="error-state"]')).toBeTruthy();
      expect(compiled.textContent).toMatch(/no se pudieron cargar/i);
      listQuestionsPaged.mockClear();
      listQuestionsPaged.mockReturnValue(of(PAGE1));
      (compiled.querySelector('[data-testid="retry-button"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(listQuestionsPaged).toHaveBeenCalledTimes(1);
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(12);
    });
  });
});
