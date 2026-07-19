import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { BankNewComponent } from './bank-new.component';
import { BankService } from '../bank.service';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';

const COURSES: Course[] = [
  { id: 'c1', name: 'Matemática' },
  { id: 'c2', name: 'Comunicación' },
];
const TOPICS_C1: Topic[] = [{ id: 't1', name: 'Álgebra', courseId: 'c1' }];
const TOPICS_C2: Topic[] = [{ id: 't2', name: 'Comprensión lectora', courseId: 'c2' }];

function setup(
  over: {
    uploadImpl?: () => unknown;
    structuredImpl?: () => unknown;
    getCourses?: () => unknown;
    getTopics?: (courseId: string) => unknown;
  } = {},
) {
  const uploadImageQuestion = vi.fn(over.uploadImpl ?? (() => of({ id: 'img-q' })));
  const createStructuredQuestion = vi.fn(over.structuredImpl ?? (() => of({ id: 'str-q' })));
  const getCourses = vi.fn(over.getCourses ?? (() => of(COURSES)));
  const getTopics = vi.fn(
    over.getTopics ?? ((courseId: string) => of(courseId === 'c1' ? TOPICS_C1 : TOPICS_C2)),
  );
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    imports: [BankNewComponent],
    providers: [
      { provide: BankService, useValue: { uploadImageQuestion, createStructuredQuestion } },
      { provide: TaxonomyService, useValue: { getCourses, getTopics } },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const fixture = TestBed.createComponent(BankNewComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    uploadImageQuestion,
    createStructuredQuestion,
    getCourses,
    getTopics,
    navigate,
  };
}

function set(fixture: { componentInstance: unknown; detectChanges(): void }, prop: string, value: unknown) {
  (fixture.componentInstance as Record<string, { set(v: unknown): void }>)[prop].set(value);
  fixture.detectChanges();
}

describe('BankNewComponent', () => {
  it('shows the photo tab by default and switches to the structured tab', () => {
    const { fixture, compiled } = setup();
    expect(compiled.querySelector('[data-testid="tab-photo-panel"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="tab-structured-panel"]')).toBeFalsy();

    (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="tab-structured-panel"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="tab-photo-panel"]')).toBeFalsy();
  });

  it('creates a structured question and navigates back to /app/bank', () => {
    const { fixture, compiled, createStructuredQuestion, navigate } = setup();
    (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    set(fixture, 'sCourseId', 'c1');
    set(fixture, 'sTopicId', 't1');
    set(fixture, 'sDifficulty', 'easy');
    set(fixture, 'sGradeLevel', 'pre');
    set(fixture, 'sBody', '¿Cuánto es 2+2?');
    set(fixture, 'sAlternatives', '4\n3\n5\n6');
    set(fixture, 'sCorrectAnswer', 'a');
    (compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement).click();
    expect(createStructuredQuestion).toHaveBeenCalledWith({
      courseId: 'c1',
      topicId: 't1',
      difficulty: 'easy',
      gradeLevel: 'pre',
      correctAnswer: 'a',
      bodyTypst: '¿Cuánto es 2+2?',
      alternatives: ['4', '3', '5', '6'],
    });
    expect(navigate).toHaveBeenCalledWith(['/app/bank']);
  });

  it('shows an inline error when structured save fails and does not navigate', () => {
    const { fixture, compiled, navigate } = setup({
      structuredImpl: () => throwError(() => new HttpErrorResponse({ status: 400 })),
    });
    (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    set(fixture, 'sCourseId', 'c1');
    set(fixture, 'sTopicId', 't1');
    set(fixture, 'sDifficulty', 'easy');
    set(fixture, 'sGradeLevel', 'pre');
    set(fixture, 'sBody', 'x');
    set(fixture, 'sAlternatives', 'a\nb');
    set(fixture, 'sCorrectAnswer', 'a');
    (compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="save-error"]')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  describe('taxonomy dropdowns (no raw UUID text inputs)', () => {
    it('loads courses from TaxonomyService and renders them as select options, no free-text course/topic inputs', () => {
      const { compiled, getCourses } = setup();
      expect(getCourses).toHaveBeenCalled();
      const courseSelect = compiled.querySelector('[data-testid="photo-course-select"] select') as HTMLSelectElement;
      expect(courseSelect).toBeTruthy();
      const optionLabels = Array.from(courseSelect.options).map((o) => o.textContent?.trim());
      expect(optionLabels).toContain('Matemática');
      expect(optionLabels).toContain('Comunicación');
      // Only one free text input remains in the photo panel: the answer
      // key ("Clave"). Course/Tema must be selects, never typed text.
      const photoPanel = compiled.querySelector('[data-testid="tab-photo-panel"]') as HTMLElement;
      expect(photoPanel.querySelectorAll('input[type="text"]').length).toBe(1);
      expect(photoPanel.querySelector('[data-testid="photo-course-select"] input')).toBeFalsy();
      expect(photoPanel.querySelector('[data-testid="photo-topic-select"] input')).toBeFalsy();
    });

    it('keeps the topic select disabled/empty until a course is picked (photo tab)', () => {
      const { compiled } = setup();
      const topicSelect = compiled.querySelector('[data-testid="photo-topic-select"] select') as HTMLSelectElement;
      expect(topicSelect.disabled).toBe(true);
      const optionLabels = Array.from(topicSelect.options).map((o) => o.textContent?.trim());
      expect(optionLabels).not.toContain('Álgebra');
      expect(optionLabels).not.toContain('Comprensión lectora');
    });

    it('loads topics for the selected course and enables the topic select (photo tab)', () => {
      const { fixture, compiled, getTopics } = setup();
      set(fixture, 'pCourseId', 'c1');
      fixture.detectChanges();
      expect(getTopics).toHaveBeenCalledWith('c1');
      const topicSelect = compiled.querySelector('[data-testid="photo-topic-select"] select') as HTMLSelectElement;
      expect(topicSelect.disabled).toBe(false);
      const optionLabels = Array.from(topicSelect.options).map((o) => o.textContent?.trim());
      expect(optionLabels).toContain('Álgebra');
    });

    it('reloads topics and resets the selected topic when the course changes (structured tab)', () => {
      const { fixture, compiled, getTopics } = setup();
      (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      set(fixture, 'sCourseId', 'c1');
      fixture.detectChanges();
      set(fixture, 'sTopicId', 't1');
      fixture.detectChanges();
      expect(getTopics).toHaveBeenCalledWith('c1');
      expect((fixture.componentInstance as unknown as { sTopicId: () => string }).sTopicId()).toBe('t1');

      set(fixture, 'sCourseId', 'c2');
      fixture.detectChanges();

      expect(getTopics).toHaveBeenCalledWith('c2');
      expect((fixture.componentInstance as unknown as { sTopicId: () => string }).sTopicId()).toBe('');
      const topicSelect = compiled.querySelector(
        '[data-testid="structured-topic-select"] select',
      ) as HTMLSelectElement;
      const optionLabels = Array.from(topicSelect.options).map((o) => o.textContent?.trim());
      expect(optionLabels).toContain('Comprensión lectora');
    });

    it('submits the picked courseId/topicId (ids, not typed text) for the structured question', () => {
      const { fixture, compiled, createStructuredQuestion } = setup();
      (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      set(fixture, 'sCourseId', 'c1');
      fixture.detectChanges();
      set(fixture, 'sTopicId', 't1');
      set(fixture, 'sDifficulty', 'easy');
      set(fixture, 'sGradeLevel', 'pre');
      set(fixture, 'sBody', 'x');
      set(fixture, 'sAlternatives', 'a\nb');
      set(fixture, 'sCorrectAnswer', 'a');
      (compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement).click();
      expect(createStructuredQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ courseId: 'c1', topicId: 't1' }),
      );
    });
  });

  describe('styled file upload (photo tab)', () => {
    it('renders a styled upload control instead of the native file input', () => {
      const { compiled } = setup();
      const photoPanel = compiled.querySelector('[data-testid="tab-photo-panel"]') as HTMLElement;
      expect(photoPanel.querySelector('[data-testid="image-upload"]')).toBeTruthy();
      // The native <input type=file> must be hidden/off-screen, not the visible "Choose File" control.
      const nativeFileInput = photoPanel.querySelector('input[type="file"]') as HTMLInputElement;
      expect(nativeFileInput).toBeTruthy();
      expect(nativeFileInput.classList.contains('sr-only')).toBe(true);
    });

    it('shows the chosen filename and a thumbnail preview after picking an image, plus a "Cambiar" affordance', () => {
      const { fixture, compiled } = setup();
      const file = new File(['fake'], 'enunciado.png', { type: 'image/png' });
      const createObjectURLSpy = vi
        .spyOn(URL, 'createObjectURL')
        .mockReturnValue('blob:fake-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

      const nativeFileInput = compiled.querySelector(
        '[data-testid="tab-photo-panel"] input[type="file"]',
      ) as HTMLInputElement;
      Object.defineProperty(nativeFileInput, 'files', { value: [file] });
      nativeFileInput.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(createObjectURLSpy).toHaveBeenCalledWith(file);
      expect(compiled.querySelector('[data-testid="image-upload-filename"]')?.textContent).toContain(
        'enunciado.png',
      );
      expect(compiled.querySelector('[data-testid="image-upload-preview"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="image-upload-change"]')).toBeTruthy();
    });
  });
});
