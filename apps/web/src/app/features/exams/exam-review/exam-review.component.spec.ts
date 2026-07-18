import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { Difficulty } from '@exams-generator/shared';
import { ExamReviewComponent } from './exam-review.component';
import { ExamsService } from '../exams.service';
import { CreateExamResult, ExamQuestionSummary } from '../exams.models';

const EXAM: CreateExamResult = { id: 'exam-1', status: 'draft', selectedQuestionIds: ['q1', 'q2'] };

const QUESTIONS: Record<string, ExamQuestionSummary> = {
  q1: { id: 'q1', courseId: 'course-1', topicId: 'topic-1', difficulty: Difficulty.Easy, correctAnswer: 'a' },
  q2: { id: 'q2', courseId: 'course-2', topicId: 'topic-2', difficulty: Difficulty.Hard, correctAnswer: 'b' },
};

function setup(overrides: {
  getQuestionById?: (id: string) => unknown;
  replaceQuestion?: (...args: unknown[]) => unknown;
  confirmExam?: (...args: unknown[]) => unknown;
}) {
  const getQuestionById = vi.fn(overrides.getQuestionById ?? ((id: string) => of(QUESTIONS[id])));
  const replaceQuestion = vi.fn(
    overrides.replaceQuestion ?? (() => of({ examId: 'exam-1', oldQuestionId: 'q1', newQuestionId: 'q3' })),
  );
  const confirmExam = vi.fn(overrides.confirmExam ?? (() => of({ id: 'exam-1', status: 'ready' })));

  TestBed.configureTestingModule({
    imports: [ExamReviewComponent],
    providers: [{ provide: ExamsService, useValue: { getQuestionById, replaceQuestion, confirmExam } }],
  });

  const fixture = TestBed.createComponent(ExamReviewComponent);
  fixture.componentRef.setInput('exam', EXAM);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  return { fixture, compiled, getQuestionById, replaceQuestion, confirmExam };
}

describe('ExamReviewComponent', () => {
  it('fetches and renders detail for every selected question', () => {
    const { compiled, getQuestionById } = setup({});

    expect(getQuestionById).toHaveBeenCalledWith('q1');
    expect(getQuestionById).toHaveBeenCalledWith('q2');
    expect(compiled.querySelectorAll('[data-testid="exam-question"]').length).toBe(2);
    expect(compiled.textContent).toContain('course-1');
    expect(compiled.textContent).toContain('course-2');
  });

  it('rerolls a question and replaces it in the list', () => {
    const { compiled, fixture, replaceQuestion, getQuestionById } = setup({
      getQuestionById: (id: string) => of(id === 'q3' ? { ...QUESTIONS['q1'], id: 'q3' } : QUESTIONS[id]),
    });
    getQuestionById.mockClear();

    compiled.querySelector<HTMLButtonElement>('[data-testid="reroll-button"]')!.click();
    fixture.detectChanges();

    expect(replaceQuestion).toHaveBeenCalledWith('exam-1', 'q1', { mode: 'reroll' });
    expect(getQuestionById).toHaveBeenCalledWith('q3');
    expect(compiled.querySelector('[data-testid="exam-question"][data-question-id="q1"]')).toBeNull();
    expect(compiled.querySelector('[data-testid="exam-question"][data-question-id="q3"]')).toBeTruthy();
  });

  it('replaces a question manually with the entered replacement id', () => {
    const { compiled, fixture, replaceQuestion } = setup({
      getQuestionById: (id: string) => of(id === 'q9' ? { ...QUESTIONS['q1'], id: 'q9' } : QUESTIONS[id]),
      replaceQuestion: () => of({ examId: 'exam-1', oldQuestionId: 'q1', newQuestionId: 'q9' }),
    });

    const manualInput = compiled.querySelector<HTMLInputElement>('[data-testid="manual-replacement-input"]')!;
    manualInput.value = 'q9';
    manualInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    compiled.querySelector<HTMLButtonElement>('[data-testid="manual-replace-button"]')!.click();
    fixture.detectChanges();

    expect(replaceQuestion).toHaveBeenCalledWith('exam-1', 'q1', { mode: 'manual', replacementQuestionId: 'q9' });
  });

  it('shows an error message when replace fails', () => {
    const { compiled, fixture } = setup({
      replaceQuestion: () => throwError(() => new HttpErrorResponse({ status: 409, error: {} })),
    });

    compiled.querySelector<HTMLButtonElement>('[data-testid="reroll-button"]')!.click();
    fixture.detectChanges();

    expect(compiled.textContent).toMatch(/could not replace/i);
  });

  it('confirms the exam and disables further replacement', () => {
    const { compiled, fixture, confirmExam } = setup({});

    compiled.querySelector<HTMLButtonElement>('[data-testid="confirm-button"]')!.click();
    fixture.detectChanges();

    expect(confirmExam).toHaveBeenCalledWith('exam-1');
    expect(compiled.textContent).toMatch(/ready/i);
    expect(compiled.querySelector<HTMLButtonElement>('[data-testid="reroll-button"]')!.disabled).toBe(true);
  });

  it('shows an error message when confirm fails', () => {
    const { compiled, fixture } = setup({
      confirmExam: () => throwError(() => new HttpErrorResponse({ status: 409, error: {} })),
    });

    compiled.querySelector<HTMLButtonElement>('[data-testid="confirm-button"]')!.click();
    fixture.detectChanges();

    expect(compiled.textContent).toMatch(/could not confirm/i);
  });
});
