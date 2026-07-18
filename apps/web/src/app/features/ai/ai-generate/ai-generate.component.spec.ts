import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AiGenerateComponent } from './ai-generate.component';
import { AiService } from '../ai.service';
import { GenerateQuestionsResult } from '../ai.models';

function setup(generateImpl: (...args: unknown[]) => unknown) {
  const generateQuestions = vi.fn(generateImpl);

  TestBed.configureTestingModule({
    imports: [AiGenerateComponent],
    providers: [{ provide: AiService, useValue: { generateQuestions } }],
  });

  const fixture = TestBed.createComponent(AiGenerateComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  const courseInput = compiled.querySelector<HTMLInputElement>('input[name="courseId"]')!;
  const topicInput = compiled.querySelector<HTMLInputElement>('input[name="topicId"]')!;
  const difficultySelect = compiled.querySelector<HTMLSelectElement>('select[name="difficulty"]')!;
  const gradeLevelSelect = compiled.querySelector<HTMLSelectElement>('select[name="gradeLevel"]')!;
  const countInput = compiled.querySelector<HTMLInputElement>('input[name="count"]')!;
  const withFigureCheckbox = compiled.querySelector<HTMLInputElement>('input[name="withFigure"]')!;
  const form = compiled.querySelector<HTMLFormElement>('form')!;

  function fillForm(overrides: {
    courseId?: string;
    topicId?: string;
    difficulty?: string;
    gradeLevel?: string;
    count?: number;
    withFigure?: boolean;
  }) {
    courseInput.value = overrides.courseId ?? 'course-1';
    courseInput.dispatchEvent(new Event('input'));
    topicInput.value = overrides.topicId ?? 'topic-1';
    topicInput.dispatchEvent(new Event('input'));
    difficultySelect.value = overrides.difficulty ?? 'medium';
    difficultySelect.dispatchEvent(new Event('change'));
    gradeLevelSelect.value = overrides.gradeLevel ?? 'primaria_3';
    gradeLevelSelect.dispatchEvent(new Event('change'));
    countInput.value = String(overrides.count ?? 5);
    countInput.dispatchEvent(new Event('input'));
    if (overrides.withFigure) {
      withFigureCheckbox.checked = true;
      withFigureCheckbox.dispatchEvent(new Event('change'));
    }

    fixture.detectChanges();
  }

  function submit() {
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  return { fixture, compiled, generateQuestions, fillForm, submit };
}

describe('AiGenerateComponent', () => {
  it('renders course/topic/difficulty/gradeLevel/count/withFigure fields', () => {
    const { compiled } = setup(() => of({ created: [], failed: [] }));

    expect(compiled.querySelector('input[name="courseId"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="topicId"]')).toBeTruthy();
    expect(compiled.querySelector('select[name="difficulty"]')).toBeTruthy();
    expect(compiled.querySelector('select[name="gradeLevel"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="count"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="withFigure"]')).toBeTruthy();
  });

  it('calls AiService.generateQuestions with the form values on submit', () => {
    const { generateQuestions, fillForm, submit } = setup(() => of({ created: [], failed: [] }));

    fillForm({
      courseId: 'course-9',
      topicId: 'topic-9',
      difficulty: 'hard',
      gradeLevel: 'secundaria_1',
      count: 8,
      withFigure: true,
    });
    submit();

    expect(generateQuestions).toHaveBeenCalledWith({
      courseId: 'course-9',
      topicId: 'topic-9',
      difficulty: 'hard',
      gradeLevel: 'secundaria_1',
      count: 8,
      withFigure: true,
    });
  });

  it('shows how many questions were created and failed after a partial-success response', () => {
    const response: GenerateQuestionsResult = {
      created: [{ id: 'q1' }, { id: 'q2' }],
      failed: [{ index: 2, error: 'invalid Typst markup' }],
    };
    const { compiled, fillForm, submit } = setup(() => of(response));

    fillForm({});
    submit();

    const result = compiled.querySelector('[data-testid="generate-result"]');
    expect(result?.textContent).toMatch(/2 created/i);
    expect(result?.textContent).toMatch(/1 failed/i);

    const failures = compiled.querySelectorAll('[data-testid="generate-failure"]');
    expect(failures.length).toBe(1);
    expect(failures[0].textContent).toContain('invalid Typst markup');
  });

  it('shows an error message when the request fails', () => {
    const serverError = new HttpErrorResponse({ status: 500 });
    const { compiled, fillForm, submit } = setup(() => throwError(() => serverError));

    fillForm({});
    submit();

    expect(compiled.textContent).toMatch(/could not generate/i);
  });

  it('does not submit when required fields are missing', () => {
    const { generateQuestions, compiled, fixture } = setup(() => of({ created: [], failed: [] }));

    const form = compiled.querySelector<HTMLFormElement>('form')!;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(generateQuestions).not.toHaveBeenCalled();
  });
});
