import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { Difficulty } from '@exams-generator/shared';
import { BankListComponent } from './bank-list.component';
import { BankService } from '../bank.service';
import { BankQuestion } from '../bank.models';

function makeQuestion(overrides: Partial<BankQuestion> & { id: string }): BankQuestion {
  return {
    id: overrides.id,
    tenantId: overrides.tenantId ?? null,
    courseId: overrides.courseId ?? 'course-1',
    topicId: overrides.topicId ?? 'topic-1',
    difficulty: overrides.difficulty ?? Difficulty.Easy,
    gradeLevel: overrides.gradeLevel ?? 'primaria_1',
    correctAnswer: overrides.correctAnswer ?? 'a',
    imageAssetId: overrides.imageAssetId ?? null,
  };
}

const TWELVE_QUESTIONS: BankQuestion[] = Array.from({ length: 12 }, (_, i) =>
  makeQuestion({
    id: `q${i}`,
    difficulty: [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard][i % 3],
    imageAssetId: i === 0 ? 'asset-1' : null,
  }),
);

function setup(overrides: {
  listQuestionsImpl?: (...args: unknown[]) => unknown;
  fetchQuestionImageImpl?: (id: string) => unknown;
}) {
  const listQuestions = vi.fn(overrides.listQuestionsImpl ?? (() => of(TWELVE_QUESTIONS)));
  const buildImageAssetUrl = vi.fn((id: string) => `http://api.test/assets/${id}`);
  const fetchQuestionImage = vi.fn(
    overrides.fetchQuestionImageImpl ??
      ((id: string) => of(new Blob([`fake-bytes-${id}`], { type: 'image/png' }))),
  );

  let objectUrlCounter = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-url-${objectUrlCounter++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  TestBed.configureTestingModule({
    imports: [BankListComponent],
    providers: [
      { provide: BankService, useValue: { listQuestions, buildImageAssetUrl, fetchQuestionImage } },
    ],
  });

  const fixture = TestBed.createComponent(BankListComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  return { fixture, compiled, listQuestions, buildImageAssetUrl, fetchQuestionImage };
}

describe('BankListComponent', () => {
  describe('with-data', () => {
    it('renders 12 questions with a difficulty tag on each, correctly color-coded', () => {
      const { compiled } = setup({});

      const items = compiled.querySelectorAll('[data-testid="bank-question"]');
      expect(items.length).toBe(12);

      const tags = compiled.querySelectorAll('[data-testid="tag"]');
      expect(tags.length).toBe(12);

      const easyTags = Array.from(tags).filter((t) => t.className.includes('bg-easy-bg'));
      const mediumTags = Array.from(tags).filter((t) => t.className.includes('bg-medium-bg'));
      const hardTags = Array.from(tags).filter((t) => t.className.includes('bg-hard-bg'));
      expect(easyTags.length).toBe(4);
      expect(mediumTags.length).toBe(4);
      expect(hardTags.length).toBe(4);
    });

    it('renders a thumbnail image sourced through an authenticated blob for questions with an imageAssetId', () => {
      const { compiled, fetchQuestionImage } = setup({});

      expect(fetchQuestionImage).toHaveBeenCalledWith('asset-1');
      const images = compiled.querySelectorAll('img');
      expect(images.length).toBe(1);
      expect(images[0].getAttribute('src')).toMatch(/^blob:/);
    });
  });

  describe('loading', () => {
    it('shows a loading indicator while the list call is pending and renders no stale data', () => {
      const subject = new Subject<BankQuestion[]>();
      const { compiled, fixture } = setup({ listQuestionsImpl: () => subject.asObservable() });

      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="bank-question"]')).toBeFalsy();

      subject.next(TWELVE_QUESTIONS);
      subject.complete();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeFalsy();
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(12);
    });
  });

  describe('empty states', () => {
    it('shows the "banco vacío" empty state (with upload CTA) when the bank has zero questions overall', () => {
      const { compiled } = setup({ listQuestionsImpl: () => of([]) });

      expect(compiled.querySelector('[data-testid="empty-bank"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="empty-no-results"]')).toBeFalsy();
      expect(compiled.textContent).toMatch(/banco vacío/i);
    });

    it('shows the distinct "sin resultados" empty state when filters yield zero results but the bank is non-empty', () => {
      const listQuestionsImpl = vi
        .fn()
        .mockReturnValueOnce(of(TWELVE_QUESTIONS)) // initial unfiltered load
        .mockReturnValueOnce(of([])); // filtered search
      const { compiled, fixture } = setup({ listQuestionsImpl });

      (fixture.componentInstance as unknown as { courseId: { set(v: string): void } }).courseId.set(
        'course-does-not-exist',
      );
      (fixture.componentInstance as unknown as { search(): void }).search();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="empty-no-results"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="empty-bank"]')).toBeFalsy();
      expect(compiled.textContent).toMatch(/sin resultados/i);
    });
  });

  describe('error', () => {
    it('shows an error state with a retry affordance when the list call fails, with no stale results', () => {
      const { compiled, fixture, listQuestions } = setup({
        listQuestionsImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });

      expect(compiled.querySelector('[data-testid="error-state"]')).toBeTruthy();
      expect(compiled.textContent).toMatch(/no se pudieron cargar/i);

      listQuestions.mockClear();
      listQuestions.mockReturnValue(of(TWELVE_QUESTIONS));

      const retryButton = compiled.querySelector<HTMLButtonElement>('[data-testid="retry-button"] button')!;
      retryButton.click();
      fixture.detectChanges();

      expect(listQuestions).toHaveBeenCalledTimes(1);
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(12);
    });
  });
});
