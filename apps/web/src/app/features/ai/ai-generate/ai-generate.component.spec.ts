import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AiGenerateComponent } from './ai-generate.component';
import { AiService } from '../ai.service';
import { GenerateQuestionsResult } from '../ai.models';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';

const COURSES: Course[] = [
  { id: 'course-1', name: 'Aritmética' },
  { id: 'course-2', name: 'Álgebra' },
];

const TOPICS_COURSE_1: Topic[] = [{ id: 'topic-1', name: 'Fracciones', courseId: 'course-1' }];

function setup(generateImpl: (...args: unknown[]) => unknown) {
  const generateQuestions = vi.fn(generateImpl);
  const getCourses = vi.fn(() => of(COURSES));
  const getTopics = vi.fn(() => of(TOPICS_COURSE_1));

  TestBed.configureTestingModule({
    imports: [AiGenerateComponent],
    providers: [
      { provide: AiService, useValue: { generateQuestions } },
      { provide: TaxonomyService, useValue: { getCourses, getTopics } },
    ],
  });

  const fixture = TestBed.createComponent(AiGenerateComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  const courseSelect = compiled.querySelector<HTMLSelectElement>('select[name="courseId"]')!;
  const topicSelect = compiled.querySelector<HTMLSelectElement>('select[name="topicId"]')!;
  const difficultySelect = compiled.querySelector<HTMLSelectElement>('select[name="difficulty"]')!;
  const gradeLevelSelect = compiled.querySelector<HTMLSelectElement>('select[name="gradeLevel"]')!;
  const countInput = compiled.querySelector<HTMLInputElement>('input[name="count"]')!;
  const withFigureCheckbox = compiled.querySelector<HTMLInputElement>('input[name="withFigure"]')!;
  const form = compiled.querySelector<HTMLFormElement>('form')!;

  function selectCourse(courseId: string) {
    courseSelect.value = courseId;
    courseSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function fillForm(overrides: {
    courseId?: string;
    topicId?: string;
    difficulty?: string;
    gradeLevel?: string;
    count?: number;
    withFigure?: boolean;
  }) {
    selectCourse(overrides.courseId ?? 'course-1');
    topicSelect.value = overrides.topicId ?? 'topic-1';
    topicSelect.dispatchEvent(new Event('change'));
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

  return { fixture, compiled, generateQuestions, getCourses, getTopics, fillForm, submit, selectCourse, topicSelect };
}

describe('AiGenerateComponent', () => {
  it('renders course/topic dropdowns plus difficulty/gradeLevel/count/withFigure fields', () => {
    const { compiled } = setup(() => of({ created: [], failed: [] }));

    expect(compiled.querySelector('select[name="courseId"]')).toBeTruthy();
    expect(compiled.querySelector('select[name="topicId"]')).toBeTruthy();
    expect(compiled.querySelector('select[name="difficulty"]')).toBeTruthy();
    expect(compiled.querySelector('select[name="gradeLevel"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="count"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="withFigure"]')).toBeTruthy();
  });

  it('loads courses from TaxonomyService and populates the course dropdown', () => {
    const { compiled, getCourses } = setup(() => of({ created: [], failed: [] }));

    expect(getCourses).toHaveBeenCalledTimes(1);
    const options = compiled.querySelectorAll('select[name="courseId"] option');
    expect(Array.from(options).some((o) => o.textContent === 'Aritmética')).toBe(true);
  });

  it('loads topics for the selected course', () => {
    const { getTopics, selectCourse } = setup(() => of({ created: [], failed: [] }));

    selectCourse('course-1');

    expect(getTopics).toHaveBeenCalledWith('course-1');
  });

  it('calls AiService.generateQuestions with the form values on submit', () => {
    const { generateQuestions, fillForm, submit } = setup(() => of({ created: [], failed: [] }));

    fillForm({
      courseId: 'course-1',
      topicId: 'topic-1',
      difficulty: 'hard',
      gradeLevel: 'secundaria_1',
      count: 8,
      withFigure: true,
    });
    submit();

    expect(generateQuestions).toHaveBeenCalledWith({
      courseId: 'course-1',
      topicId: 'topic-1',
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
    expect(result?.textContent).toMatch(/2 creadas/i);
    expect(result?.textContent).toMatch(/1 fallidas/i);

    const failures = compiled.querySelectorAll('[data-testid="generate-failure"]');
    expect(failures.length).toBe(1);
    expect(failures[0].textContent).toContain('invalid Typst markup');
  });

  it('renders both successes and failures distinctly on a partial-success response, never collapsing them (AG-R1)', () => {
    const response: GenerateQuestionsResult = {
      created: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }, { id: 'q4' }],
      failed: [{ index: 4, error: 'invalid Typst markup' }],
    };
    const { compiled, fillForm, submit } = setup(() => of(response));

    fillForm({});
    submit();

    const successes = compiled.querySelectorAll('[data-testid="generate-success"]');
    expect(successes.length).toBe(4);
    const failures = compiled.querySelectorAll('[data-testid="generate-failure"]');
    expect(failures.length).toBe(1);
  });

  it('marks every created question as "borrador" (draft), never as "aprobada" (AG-R2)', () => {
    const response: GenerateQuestionsResult = {
      created: [{ id: 'q1' }, { id: 'q2' }],
      failed: [],
    };
    const { compiled, fillForm, submit } = setup(() => of(response));

    fillForm({});
    submit();

    const successes = compiled.querySelectorAll('[data-testid="generate-success"]');
    expect(successes.length).toBe(2);
    for (const success of Array.from(successes)) {
      expect(success.textContent).toMatch(/borrador/i);
      expect(success.textContent).not.toMatch(/aprobada/i);
    }
  });

  it('shows an error message when the request fails', () => {
    const serverError = new HttpErrorResponse({ status: 500 });
    const { compiled, fillForm, submit } = setup(() => throwError(() => serverError));

    fillForm({});
    submit();

    expect(compiled.textContent).toMatch(/no se pudieron generar/i);
  });

  it('does not submit when required fields are missing', () => {
    const { generateQuestions, compiled, fixture } = setup(() => of({ created: [], failed: [] }));

    const form = compiled.querySelector<HTMLFormElement>('form')!;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(generateQuestions).not.toHaveBeenCalled();
  });
});
