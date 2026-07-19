import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { Difficulty } from '@exams-generator/shared';
import { ExamReviewComponent } from './exam-review.component';
import { ExamsService } from '../exams.service';
import { ExamDetail } from '../exams.models';

const EXAM: ExamDetail = {
  id: 'exam-1',
  title: 'Simulacro',
  gradeLevel: 'primaria_1',
  status: 'draft',
  questions: [
    {
      id: 'q1',
      position: 0,
      type: 'image',
      courseId: 'course-1',
      topicId: 'topic-1',
      difficulty: Difficulty.Easy,
      correctAnswer: 'a',
      imageAssetId: 'asset-1',
      bodyTypst: null,
      alternatives: null,
      figureCode: null,
    },
    {
      id: 'q2',
      position: 1,
      type: 'image',
      courseId: 'course-2',
      topicId: 'topic-2',
      difficulty: Difficulty.Hard,
      correctAnswer: 'b',
      imageAssetId: 'asset-2',
      bodyTypst: null,
      alternatives: null,
      figureCode: null,
    },
  ],
};

function setup(overrides: {
  getExam?: (id: string) => unknown;
  replaceQuestion?: (...args: unknown[]) => unknown;
  confirmExam?: (...args: unknown[]) => unknown;
}) {
  const getExam = vi.fn(overrides.getExam ?? (() => of(EXAM)));
  const replaceQuestion = vi.fn(
    overrides.replaceQuestion ?? (() => of({ examId: 'exam-1', oldQuestionId: 'q1', newQuestionId: 'q3' })),
  );
  const confirmExam = vi.fn(overrides.confirmExam ?? (() => of({ id: 'exam-1', status: 'ready' })));

  TestBed.configureTestingModule({
    imports: [ExamReviewComponent],
    providers: [
      { provide: ExamsService, useValue: { getExam, replaceQuestion, confirmExam } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ examId: 'exam-1' }) } },
      },
    ],
  });

  const fixture = TestBed.createComponent(ExamReviewComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  return { fixture, compiled, getExam, replaceQuestion, confirmExam };
}

describe('ExamReviewComponent', () => {
  it('loads the exam by id from the route param and renders every selected question', () => {
    const { compiled, getExam } = setup({});

    expect(getExam).toHaveBeenCalledWith('exam-1');
    expect(compiled.querySelectorAll('[data-testid="exam-question"]').length).toBe(2);
    expect(compiled.textContent).toContain('course-1');
    expect(compiled.textContent).toContain('course-2');
    expect(compiled.textContent).toContain('Simulacro');
  });

  it('shows an error message when the exam fails to load', () => {
    const { compiled } = setup({
      getExam: () => throwError(() => new HttpErrorResponse({ status: 404, error: {} })),
    });

    expect(compiled.textContent).toMatch(/no se pudo cargar/i);
  });

  it('rerolls a question and reloads the exam detail', () => {
    const { compiled, fixture, replaceQuestion, getExam } = setup({});
    getExam.mockClear();
    getExam.mockReturnValue(
      of({
        ...EXAM,
        questions: [{ ...EXAM.questions[0]!, id: 'q3' }, EXAM.questions[1]!],
      }),
    );

    compiled.querySelector<HTMLButtonElement>('[data-testid="reroll-button"]')!.click();
    fixture.detectChanges();

    expect(replaceQuestion).toHaveBeenCalledWith('exam-1', 'q1', { mode: 'reroll' });
    expect(getExam).toHaveBeenCalledWith('exam-1');
    expect(compiled.querySelector('[data-testid="exam-question"][data-question-id="q1"]')).toBeNull();
    expect(compiled.querySelector('[data-testid="exam-question"][data-question-id="q3"]')).toBeTruthy();
  });

  it('replaces a question manually with the entered replacement id', () => {
    const { compiled, fixture, replaceQuestion } = setup({
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

    expect(compiled.textContent).toMatch(/no se pudo reemplazar/i);
  });

  it('confirms the exam and disables further replacement', () => {
    const { compiled, fixture, confirmExam } = setup({});

    compiled.querySelector<HTMLButtonElement>('[data-testid="confirm-button"]')!.click();
    fixture.detectChanges();

    expect(confirmExam).toHaveBeenCalledWith('exam-1');
    expect(compiled.textContent).toMatch(/listo/i);
    expect(compiled.querySelector<HTMLButtonElement>('[data-testid="reroll-button"]')!.disabled).toBe(true);
  });

  it('shows an error message when confirm fails', () => {
    const { compiled, fixture } = setup({
      confirmExam: () => throwError(() => new HttpErrorResponse({ status: 409, error: {} })),
    });

    compiled.querySelector<HTMLButtonElement>('[data-testid="confirm-button"]')!.click();
    fixture.detectChanges();

    expect(compiled.textContent).toMatch(/no se pudo confirmar/i);
  });
});
