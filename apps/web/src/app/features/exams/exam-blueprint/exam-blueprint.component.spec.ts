import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { Difficulty } from '@exams-generator/shared';
import { ExamBlueprintComponent } from './exam-blueprint.component';
import { ExamsService } from '../exams.service';
import { CreateExamResult } from '../exams.models';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';

const COURSES: Course[] = [
  { id: 'course-1', name: 'Aritmética' },
  { id: 'course-2', name: 'Álgebra' },
];

const TOPICS_COURSE_1: Topic[] = [{ id: 'topic-1', name: 'Fracciones', courseId: 'course-1' }];
const TOPICS_COURSE_2: Topic[] = [{ id: 'topic-2', name: 'Ecuaciones', courseId: 'course-2' }];

function setup(createExamImpl: (...args: unknown[]) => unknown) {
  const createExam = vi.fn(createExamImpl);
  const getCourses = vi.fn(() => of(COURSES));
  const getTopics = vi.fn((courseId: string) =>
    of(courseId === 'course-2' ? TOPICS_COURSE_2 : TOPICS_COURSE_1),
  );

  TestBed.configureTestingModule({
    imports: [ExamBlueprintComponent],
    providers: [
      { provide: ExamsService, useValue: { createExam } },
      { provide: TaxonomyService, useValue: { getCourses, getTopics } },
    ],
  });

  const fixture = TestBed.createComponent(ExamBlueprintComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  return { fixture, compiled, createExam, getCourses, getTopics };
}

function selectCourseForRow(compiled: HTMLElement, fixture: { detectChanges(): void }, rowIndex: number, courseId: string) {
  const rows = compiled.querySelectorAll('[data-testid="blueprint-row"]');
  const courseSelect = rows[rowIndex].querySelector<HTMLSelectElement>('select[name="courseId"]')!;
  courseSelect.value = courseId;
  courseSelect.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

function fillFirstRow(compiled: HTMLElement, fixture: { detectChanges(): void }) {
  const titleInput = compiled.querySelector<HTMLInputElement>('input[name="title"]')!;
  const gradeLevelSelect = compiled.querySelector<HTMLSelectElement>('select[name="gradeLevel"]')!;
  const countInput = compiled.querySelector<HTMLInputElement>('[data-testid="blueprint-row"] input[name="count"]')!;

  titleInput.value = 'Admisión 2026';
  titleInput.dispatchEvent(new Event('input'));
  gradeLevelSelect.value = 'secundaria_5';
  gradeLevelSelect.dispatchEvent(new Event('change'));
  selectCourseForRow(compiled, fixture, 0, 'course-1');
  countInput.value = '5';
  countInput.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

describe('ExamBlueprintComponent', () => {
  it('renders exactly one blueprint row by default', () => {
    const { compiled } = setup(() => of({}));

    expect(compiled.querySelectorAll('[data-testid="blueprint-row"]').length).toBe(1);
  });

  it('renders a course dropdown (not free text) in each blueprint row', () => {
    const { compiled } = setup(() => of({}));

    const row = compiled.querySelector('[data-testid="blueprint-row"]')!;
    expect(row.querySelector('select[name="courseId"]')).toBeTruthy();
    expect(row.querySelector('input[name="courseId"]')).toBeFalsy();
  });

  it('loads courses from TaxonomyService on init', () => {
    const { getCourses } = setup(() => of({}));

    expect(getCourses).toHaveBeenCalledTimes(1);
  });

  it('loads topics for the row when its course is selected', () => {
    const { compiled, fixture, getTopics } = setup(() => of({}));

    selectCourseForRow(compiled, fixture, 0, 'course-1');

    expect(getTopics).toHaveBeenCalledWith('course-1');
    const row = compiled.querySelector('[data-testid="blueprint-row"]')!;
    const options = row.querySelectorAll('select[name="topicId"] option');
    expect(Array.from(options).some((o) => o.textContent === 'Fracciones')).toBe(true);
  });

  it('adds a new blueprint row when "Add row" is clicked, with its own independent course/topic dropdowns', () => {
    const { compiled, fixture, getTopics } = setup(() => of({}));

    compiled.querySelector<HTMLButtonElement>('[data-testid="add-row-button"]')!.click();
    fixture.detectChanges();

    expect(compiled.querySelectorAll('[data-testid="blueprint-row"]').length).toBe(2);

    selectCourseForRow(compiled, fixture, 0, 'course-1');
    selectCourseForRow(compiled, fixture, 1, 'course-2');

    expect(getTopics).toHaveBeenCalledWith('course-1');
    expect(getTopics).toHaveBeenCalledWith('course-2');

    const rows = compiled.querySelectorAll('[data-testid="blueprint-row"]');
    const row0Options = rows[0].querySelectorAll('select[name="topicId"] option');
    const row1Options = rows[1].querySelectorAll('select[name="topicId"] option');
    expect(Array.from(row0Options).some((o) => o.textContent === 'Fracciones')).toBe(true);
    expect(Array.from(row1Options).some((o) => o.textContent === 'Ecuaciones')).toBe(true);
  });

  it('does not remove the last remaining row', () => {
    const { compiled, fixture } = setup(() => of({}));

    compiled.querySelector<HTMLButtonElement>('[data-testid="remove-row-button"]')!.click();
    fixture.detectChanges();

    expect(compiled.querySelectorAll('[data-testid="blueprint-row"]').length).toBe(1);
  });

  it('does not call createExam when the form is submitted invalid', () => {
    const { compiled, fixture, createExam } = setup(() => of({}));

    compiled.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(createExam).not.toHaveBeenCalled();
  });

  it('submits the blueprint payload and emits examCreated on success', () => {
    const result: CreateExamResult = { id: 'exam-1', status: 'draft', selectedQuestionIds: ['q1'] };
    const { compiled, fixture, createExam } = setup(() => of(result));

    const component = fixture.componentInstance;
    let emitted: CreateExamResult | undefined;
    component.examCreated.subscribe((r: CreateExamResult) => (emitted = r));

    fillFirstRow(compiled, fixture);
    compiled.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(createExam).toHaveBeenCalledWith({
      title: 'Admisión 2026',
      gradeLevel: 'secundaria_5',
      blueprint: [{ courseId: 'course-1', topicId: undefined, difficulty: undefined, count: 5 }],
    });
    expect(emitted).toEqual(result);
  });

  it('shows shortages returned by a 422 response and does not emit examCreated', () => {
    const errorBody = {
      message: 'Insufficient question stock for 1 blueprint row(s) on exam exam-1',
      examId: 'exam-1',
      shortages: [
        {
          blueprintRowId: 'row-1',
          courseId: 'course-1',
          courseName: 'Aritmética',
          difficulty: Difficulty.Medium,
          requested: 5,
          available: 3,
        },
      ],
    };
    const { compiled, fixture, createExam } = setup(() =>
      throwError(() => new HttpErrorResponse({ status: 422, error: errorBody })),
    );

    const component = fixture.componentInstance;
    let emitted: CreateExamResult | undefined;
    component.examCreated.subscribe((r: CreateExamResult) => (emitted = r));

    fillFirstRow(compiled, fixture);
    compiled.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(createExam).toHaveBeenCalled();
    expect(emitted).toBeUndefined();
    const shortageItems = compiled.querySelectorAll('[data-testid="shortage-item"]');
    expect(shortageItems.length).toBe(1);
    expect(shortageItems[0].textContent).toContain('Aritmética');
    expect(shortageItems[0].textContent).toContain('5');
    expect(shortageItems[0].textContent).toContain('3');
  });

  it('shows a generic error message on non-422 failures', () => {
    const { compiled, fixture } = setup(() =>
      throwError(() => new HttpErrorResponse({ status: 500, error: {} })),
    );

    fillFirstRow(compiled, fixture);
    compiled.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(compiled.textContent).toMatch(/could not create/i);
  });
});
