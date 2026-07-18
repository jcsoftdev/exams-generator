import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { BankUploadComponent } from './bank-upload.component';
import { BankService } from '../bank.service';

function setup(uploadImpl: (...args: unknown[]) => unknown) {
  const uploadImageQuestion = vi.fn(uploadImpl);

  TestBed.configureTestingModule({
    imports: [BankUploadComponent],
    providers: [{ provide: BankService, useValue: { uploadImageQuestion } }],
  });

  const fixture = TestBed.createComponent(BankUploadComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  const courseInput = compiled.querySelector<HTMLInputElement>('input[name="courseId"]')!;
  const topicInput = compiled.querySelector<HTMLInputElement>('input[name="topicId"]')!;
  const difficultySelect = compiled.querySelector<HTMLSelectElement>('select[name="difficulty"]')!;
  const gradeLevelSelect = compiled.querySelector<HTMLSelectElement>('select[name="gradeLevel"]')!;
  const answerInput = compiled.querySelector<HTMLInputElement>('input[name="correctAnswer"]')!;
  const fileInput = compiled.querySelector<HTMLInputElement>('input[type="file"]')!;
  const form = compiled.querySelector<HTMLFormElement>('form')!;

  function fillForm(overrides: {
    courseId?: string;
    topicId?: string;
    difficulty?: string;
    gradeLevel?: string;
    correctAnswer?: string;
    file?: File;
  }) {
    courseInput.value = overrides.courseId ?? 'course-1';
    courseInput.dispatchEvent(new Event('input'));
    topicInput.value = overrides.topicId ?? 'topic-1';
    topicInput.dispatchEvent(new Event('input'));
    difficultySelect.value = overrides.difficulty ?? 'medium';
    difficultySelect.dispatchEvent(new Event('change'));
    gradeLevelSelect.value = overrides.gradeLevel ?? 'primaria_3';
    gradeLevelSelect.dispatchEvent(new Event('change'));
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

  return { fixture, compiled, uploadImageQuestion, fillForm, submit, fileInput };
}

describe('BankUploadComponent', () => {
  it('renders course/topic/difficulty/gradeLevel/correctAnswer fields plus a file input', () => {
    const { compiled } = setup(() => of({ id: 'new-id' }));

    expect(compiled.querySelector('input[name="courseId"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="topicId"]')).toBeTruthy();
    expect(compiled.querySelector('select[name="difficulty"]')).toBeTruthy();
    expect(compiled.querySelector('select[name="gradeLevel"]')).toBeTruthy();
    expect(compiled.querySelector('input[name="correctAnswer"]')).toBeTruthy();
    expect(compiled.querySelector('input[type="file"]')).toBeTruthy();
  });

  it('calls BankService.uploadImageQuestion with the taxonomy fields and selected file on submit', () => {
    const { uploadImageQuestion, fillForm, submit } = setup(() => of({ id: 'new-id' }));
    const file = new File(['fake-bytes'], 'question.png', { type: 'image/png' });

    fillForm({
      courseId: 'course-9',
      topicId: 'topic-9',
      difficulty: 'hard',
      gradeLevel: 'secundaria_1',
      correctAnswer: 'd',
      file,
    });
    submit();

    expect(uploadImageQuestion).toHaveBeenCalledWith({
      courseId: 'course-9',
      topicId: 'topic-9',
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

    expect(compiled.textContent).toMatch(/success/i);
  });

  it('shows an error message and does not reset when the upload fails', () => {
    const badRequest = new HttpErrorResponse({ status: 400, statusText: 'Bad Request' });
    const { compiled, fillForm, submit } = setup(() => throwError(() => badRequest));

    fillForm({});
    submit();

    expect(compiled.textContent).toMatch(/could not upload/i);
  });

  it('does not submit when required fields are missing', () => {
    const { uploadImageQuestion, compiled, fixture } = setup(() => of({ id: 'new-id' }));

    const form = compiled.querySelector<HTMLFormElement>('form')!;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(uploadImageQuestion).not.toHaveBeenCalled();
  });
});
