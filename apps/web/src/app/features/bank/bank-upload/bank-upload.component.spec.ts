import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { BankUploadComponent } from './bank-upload.component';
import { BankService } from '../bank.service';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';

const COURSES: Course[] = [
  { id: 'course-1', name: 'Aritmética' },
  { id: 'course-2', name: 'Álgebra' },
];

const TOPICS_COURSE_1: Topic[] = [{ id: 'topic-1', name: 'Fracciones', courseId: 'course-1' }];

function setup(
  uploadImpl: (...args: unknown[]) => unknown,
  taxonomyOverrides: { getCourses?: () => unknown; getTopics?: (...args: unknown[]) => unknown } = {},
) {
  const uploadImageQuestion = vi.fn(uploadImpl);
  const getCourses = vi.fn(taxonomyOverrides.getCourses ?? (() => of(COURSES)));
  const getTopics = vi.fn(taxonomyOverrides.getTopics ?? (() => of(TOPICS_COURSE_1)));

  TestBed.configureTestingModule({
    imports: [BankUploadComponent],
    providers: [
      { provide: BankService, useValue: { uploadImageQuestion } },
      { provide: TaxonomyService, useValue: { getCourses, getTopics } },
    ],
  });

  const fixture = TestBed.createComponent(BankUploadComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  const courseSelect = compiled.querySelector<HTMLSelectElement>('select[name="courseId"]')!;
  const topicSelect = compiled.querySelector<HTMLSelectElement>('select[name="topicId"]')!;
  const difficultySelect = compiled.querySelector<HTMLSelectElement>('select[name="difficulty"]')!;
  const gradeLevelSelect = compiled.querySelector<HTMLSelectElement>('select[name="gradeLevel"]')!;
  const answerInput = compiled.querySelector<HTMLInputElement>('input[name="correctAnswer"]')!;
  const fileInput = compiled.querySelector<HTMLInputElement>('input[type="file"]')!;
  const form = compiled.querySelector<HTMLFormElement>('form')!;

  function selectGrade(gradeLevel: string) {
    gradeLevelSelect.value = gradeLevel;
    gradeLevelSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

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
    correctAnswer?: string;
    file?: File;
  }) {
    selectGrade(overrides.gradeLevel ?? 'primaria_3');
    selectCourse(overrides.courseId ?? 'course-1');
    topicSelect.value = overrides.topicId ?? 'topic-1';
    topicSelect.dispatchEvent(new Event('change'));
    difficultySelect.value = overrides.difficulty ?? 'medium';
    difficultySelect.dispatchEvent(new Event('change'));
    answerInput.value = overrides.correctAnswer ?? 'b';
    answerInput.dispatchEvent(new Event('input'));

    const file = overrides.file ?? new File(['fake-bytes'], 'question.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event('change'));

    fixture.detectChanges();
  }

  function submit() {
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  return {
    fixture,
    compiled,
    uploadImageQuestion,
    getCourses,
    getTopics,
    fillForm,
    submit,
    fileInput,
    courseSelect,
    topicSelect,
    gradeLevelSelect,
    selectCourse,
    selectGrade,
  };
}

describe('BankUploadComponent', () => {
  it('renders course/topic dropdowns plus difficulty/gradeLevel/correctAnswer fields and a file input', () => {
    const { compiled } = setup(() => of({ id: 'new-id' }));

    expect(compiled.querySelector('select[name="courseId"]')).toBeTruthy();
    expect(compiled.querySelector('select[name="topicId"]')).toBeTruthy();
    expect(compiled.querySelector('select[name="difficulty"]')).toBeTruthy();
    expect(compiled.querySelector('select[name="gradeLevel"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="correctAnswer"]')).toBeTruthy();
    expect(compiled.querySelector('input[type="file"]')).toBeTruthy();
  });

  it('does not load courses until a grade level is picked, and disables the course dropdown', () => {
    const { compiled, getCourses, courseSelect } = setup(() => of({ id: 'new-id' }));

    expect(getCourses).not.toHaveBeenCalled();
    expect(courseSelect.disabled).toBe(true);
    const options = compiled.querySelectorAll('select[name="courseId"] option');
    expect(options.length).toBe(1);
  });

  it('loads courses scoped to the selected grade level and populates the course dropdown', () => {
    const { compiled, getCourses, courseSelect, selectGrade } = setup(() => of({ id: 'new-id' }));

    selectGrade('primaria_3');

    expect(getCourses).toHaveBeenCalledTimes(1);
    expect(getCourses).toHaveBeenCalledWith('primaria_3');
    expect(courseSelect.disabled).toBe(false);
    const options = compiled.querySelectorAll('select[name="courseId"] option');
    expect(Array.from(options).some((o) => o.textContent === 'Aritmética')).toBe(true);
    expect(Array.from(options).some((o) => o.textContent === 'Álgebra')).toBe(true);
  });

  it('reloads courses and resets course/topic when the grade level changes', () => {
    const { getCourses, selectGrade, selectCourse, courseSelect, topicSelect } = setup(() => of({ id: 'new-id' }));

    selectGrade('primaria_3');
    selectCourse('course-1');
    topicSelect.value = 'topic-1';
    topicSelect.dispatchEvent(new Event('change'));

    selectGrade('secundaria_1');

    expect(getCourses).toHaveBeenCalledTimes(2);
    expect(getCourses).toHaveBeenNthCalledWith(2, 'secundaria_1');
    expect(courseSelect.value).toBe('');
    expect(topicSelect.value).toBe('');
  });

  it('loads topics for the selected course and populates the topic dropdown', () => {
    const { compiled, getTopics, selectGrade, selectCourse } = setup(() => of({ id: 'new-id' }));

    selectGrade('primaria_3');
    selectCourse('course-1');

    expect(getTopics).toHaveBeenCalledWith('course-1', 'primaria_3');
    const options = compiled.querySelectorAll('select[name="topicId"] option');
    expect(Array.from(options).some((o) => o.textContent === 'Fracciones')).toBe(true);
  });

  it('resets the selected topic when the course changes', () => {
    const { topicSelect, selectGrade, selectCourse, fixture } = setup(() => of({ id: 'new-id' }));

    selectGrade('primaria_3');
    selectCourse('course-1');
    topicSelect.value = 'topic-1';
    topicSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    selectCourse('course-2');

    expect(topicSelect.value).toBe('');
  });

  it('calls BankService.uploadImageQuestion with the taxonomy fields and selected file on submit', () => {
    const { uploadImageQuestion, fillForm, submit } = setup(() => of({ id: 'new-id' }));
    const file = new File(['fake-bytes'], 'question.png', { type: 'image/png' });

    fillForm({
      courseId: 'course-1',
      topicId: 'topic-1',
      difficulty: 'hard',
      gradeLevel: 'secundaria_1',
      correctAnswer: 'd',
      file,
    });
    submit();

    expect(uploadImageQuestion).toHaveBeenCalledWith({
      courseId: 'course-1',
      topicId: 'topic-1',
      difficulty: 'hard',
      gradeLevel: 'secundaria_1',
      correctAnswer: 'd',
      image: file,
    });
  });

  it('shows a success message and resets the form after a successful upload', () => {
    const { compiled, fillForm, submit } = setup(() => of({ id: 'new-id' }));

    fillForm({});
    submit();

    expect(compiled.textContent).toMatch(/correctamente/i);
  });

  it('shows an error message and does not reset when the upload fails', () => {
    const badRequest = new HttpErrorResponse({ status: 400, statusText: 'Bad Request' });
    const { compiled, fillForm, submit } = setup(() => throwError(() => badRequest));

    fillForm({});
    submit();

    expect(compiled.textContent).toMatch(/no se pudo subir/i);
  });

  it('does not submit when required fields are missing', () => {
    const { uploadImageQuestion, compiled, fixture } = setup(() => of({ id: 'new-id' }));

    const form = compiled.querySelector<HTMLFormElement>('form')!;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(uploadImageQuestion).not.toHaveBeenCalled();
  });
});
