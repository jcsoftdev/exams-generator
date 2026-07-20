import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { BankNewComponent } from './bank-new.component';
import { BankService } from '../bank.service';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { AiService } from '../../ai/ai.service';
import { AiRevisedQuestion } from '../../ai/ai.models';

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
    extractQuestionFromImageImpl?: (image: File) => unknown;
  } = {},
) {
  const uploadImageQuestion = vi.fn(over.uploadImpl ?? (() => of({ id: 'img-q' })));
  const createStructuredQuestion = vi.fn(over.structuredImpl ?? (() => of({ id: 'str-q' })));
  const getCourses = vi.fn(over.getCourses ?? (() => of(COURSES)));
  const getTopics = vi.fn(
    over.getTopics ?? ((courseId: string) => of(courseId === 'c1' ? TOPICS_C1 : TOPICS_C2)),
  );
  const extracted: AiRevisedQuestion = {
    bodyTypst: 'Enunciado desde imagen',
    alternatives: ['Alt A extraída', 'Alt B extraída'],
    correctAnswer: '1',
  };
  const extractQuestionFromImage = vi.fn(
    over.extractQuestionFromImageImpl ?? (() => of(extracted)),
  );
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    imports: [BankNewComponent],
    providers: [
      { provide: BankService, useValue: { uploadImageQuestion, createStructuredQuestion } },
      { provide: TaxonomyService, useValue: { getCourses, getTopics } },
      { provide: AiService, useValue: { extractQuestionFromImage } },
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
    extractQuestionFromImage,
    navigate,
  };
}

function set(fixture: { componentInstance: unknown; detectChanges(): void }, prop: string, value: unknown) {
  (fixture.componentInstance as Record<string, { set(v: unknown): void }>)[prop].set(value);
  fixture.detectChanges();
}

/** Opens the `ui-select` scoped under `testid`, reads the rendered option labels, then leaves it open. */
function openAndReadOptionLabels(
  compiled: HTMLElement,
  fixture: { detectChanges(): void },
  testid: string,
): (string | undefined)[] {
  const container = compiled.querySelector(`[data-testid="${testid}"]`) as HTMLElement;
  (container.querySelector('button[role="combobox"]') as HTMLButtonElement).click();
  fixture.detectChanges();
  return Array.from(container.querySelectorAll('[data-testid="select-option"]')).map((o) => o.textContent?.trim());
}

/** The trigger button for the `ui-select` scoped under `testid` — mirrors the old `<select>` element for disabled checks. */
function selectTrigger(compiled: HTMLElement, testid: string): HTMLButtonElement {
  return compiled.querySelector(`[data-testid="${testid}"] button[role="combobox"]`) as HTMLButtonElement;
}

/**
 * Reads the `options()` bound to the `ui-select` scoped under `testid` directly off the
 * component instance — the DISABLED trigger can't be opened via click, so this is the
 * equivalent of reading a disabled native `<select>`'s (still-present) `<option>` list.
 */
function selectOptionsOf(fixture: { debugElement: { query(pred: unknown): { componentInstance: unknown } | null } }, testid: string): readonly SelectOption<unknown>[] {
  const debugEl = fixture.debugElement.query(By.css(`[data-testid="${testid}"] ui-select`));
  const instance = debugEl!.componentInstance as SelectComponent<unknown>;
  return instance.options();
}

function fillPhotoTaxonomy(fixture: { componentInstance: unknown; detectChanges(): void }) {
  set(fixture, 'pGradeLevel', 'pre');
  set(fixture, 'pCourseId', 'c1');
  set(fixture, 'pTopicId', 't1');
  set(fixture, 'pDifficulty', 'easy');
}

function pickImage(fixture: { detectChanges(): void }, compiled: HTMLElement): File {
  const file = new File(['bytes'], 'foto.png', { type: 'image/png' });
  const nativeFileInput = compiled.querySelector(
    '[data-testid="tab-photo-panel"] input[type="file"]',
  ) as HTMLInputElement;
  Object.defineProperty(nativeFileInput, 'files', { value: [file], configurable: true });
  nativeFileInput.dispatchEvent(new Event('change'));
  fixture.detectChanges();
  return file;
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
    set(fixture, 'sGradeLevel', 'pre');
    set(fixture, 'sCourseId', 'c1');
    set(fixture, 'sTopicId', 't1');
    set(fixture, 'sDifficulty', 'easy');
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
    set(fixture, 'sGradeLevel', 'pre');
    set(fixture, 'sCourseId', 'c1');
    set(fixture, 'sTopicId', 't1');
    set(fixture, 'sDifficulty', 'easy');
    set(fixture, 'sBody', 'x');
    set(fixture, 'sAlternatives', 'a\nb');
    set(fixture, 'sCorrectAnswer', 'a');
    (compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="save-error"]')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  describe('taxonomy dropdowns (no raw UUID text inputs)', () => {
    it('does not load courses until a grade level is picked, and disables the course select (photo tab)', () => {
      const { compiled, getCourses } = setup();
      expect(getCourses).not.toHaveBeenCalled();
      const courseTrigger = selectTrigger(compiled, 'photo-course-select');
      expect(courseTrigger).toBeTruthy();
      expect(courseTrigger.disabled).toBe(true);
    });

    it('loads courses scoped to the picked grade level and renders them as select options, no free-text course/topic inputs (photo tab)', () => {
      const { fixture, compiled, getCourses } = setup();
      set(fixture, 'pGradeLevel', 'pre');

      expect(getCourses).toHaveBeenCalledWith('pre');
      const courseTrigger = selectTrigger(compiled, 'photo-course-select');
      expect(courseTrigger.disabled).toBe(false);
      const optionLabels = openAndReadOptionLabels(compiled, fixture, 'photo-course-select');
      expect(optionLabels).toContain('Matemática');
      expect(optionLabels).toContain('Comunicación');
      // Only one free text input remains in the photo panel: the answer
      // key ("Clave"). Grado/Curso/Tema must be selects, never typed text.
      const photoPanel = compiled.querySelector('[data-testid="tab-photo-panel"]') as HTMLElement;
      expect(photoPanel.querySelectorAll('input[type="text"]').length).toBe(1);
      expect(photoPanel.querySelector('[data-testid="photo-course-select"] input')).toBeFalsy();
      expect(photoPanel.querySelector('[data-testid="photo-topic-select"] input')).toBeFalsy();
    });

    it('keeps the topic select disabled/empty until a course is picked (photo tab)', () => {
      const { fixture, compiled } = setup();
      const topicTrigger = selectTrigger(compiled, 'photo-topic-select');
      expect(topicTrigger.disabled).toBe(true);
      // Disabled — can't open it via click, so read the bound `options()` directly
      // (the same public data a disabled native <select> would still carry).
      const optionLabels = selectOptionsOf(fixture, 'photo-topic-select').map((o) => o.label);
      expect(optionLabels).not.toContain('Álgebra');
      expect(optionLabels).not.toContain('Comprensión lectora');
    });

    it('loads topics for the selected course, scoped to the picked grade, and enables the topic select (photo tab)', () => {
      const { fixture, compiled, getTopics } = setup();
      set(fixture, 'pGradeLevel', 'pre');
      set(fixture, 'pCourseId', 'c1');
      fixture.detectChanges();
      expect(getTopics).toHaveBeenCalledWith('c1', 'pre');
      const topicTrigger = selectTrigger(compiled, 'photo-topic-select');
      expect(topicTrigger.disabled).toBe(false);
      const optionLabels = openAndReadOptionLabels(compiled, fixture, 'photo-topic-select');
      expect(optionLabels).toContain('Álgebra');
    });

    it('reloads courses and resets the selected course when the grade level changes (structured tab)', () => {
      const { fixture, compiled, getCourses } = setup();
      (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      set(fixture, 'sGradeLevel', 'pre');
      set(fixture, 'sCourseId', 'c1');
      fixture.detectChanges();
      expect((fixture.componentInstance as unknown as { sCourseId: () => string }).sCourseId()).toBe('c1');

      set(fixture, 'sGradeLevel', 'esc');
      fixture.detectChanges();

      expect(getCourses).toHaveBeenNthCalledWith(2, 'esc');
      expect((fixture.componentInstance as unknown as { sCourseId: () => string }).sCourseId()).toBe('');
    });

    it('reloads topics and resets the selected topic when the course changes (structured tab)', () => {
      const { fixture, compiled, getTopics } = setup();
      (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      set(fixture, 'sGradeLevel', 'pre');
      set(fixture, 'sCourseId', 'c1');
      fixture.detectChanges();
      set(fixture, 'sTopicId', 't1');
      fixture.detectChanges();
      expect(getTopics).toHaveBeenCalledWith('c1', 'pre');
      expect((fixture.componentInstance as unknown as { sTopicId: () => string }).sTopicId()).toBe('t1');

      set(fixture, 'sCourseId', 'c2');
      fixture.detectChanges();

      expect(getTopics).toHaveBeenCalledWith('c2', 'pre');
      expect((fixture.componentInstance as unknown as { sTopicId: () => string }).sTopicId()).toBe('');
      const optionLabels = openAndReadOptionLabels(compiled, fixture, 'structured-topic-select');
      expect(optionLabels).toContain('Comprensión lectora');
    });

    it('submits the picked courseId/topicId (ids, not typed text) for the structured question', () => {
      const { fixture, compiled, createStructuredQuestion } = setup();
      (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      set(fixture, 'sGradeLevel', 'pre');
      set(fixture, 'sCourseId', 'c1');
      fixture.detectChanges();
      set(fixture, 'sTopicId', 't1');
      set(fixture, 'sDifficulty', 'easy');
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

  describe('extractWithAi (photo tab AI shortcut)', () => {
    it('calls extractQuestionFromImage with the picked file when photo taxonomy + image are complete', () => {
      const { fixture, compiled, extractQuestionFromImage } = setup();
      fillPhotoTaxonomy(fixture);
      const file = pickImage(fixture, compiled);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();

      expect(extractQuestionFromImage).toHaveBeenCalledWith(file);
    });

    it('does nothing if photo taxonomy is incomplete (no image picked)', () => {
      const { fixture, extractQuestionFromImage } = setup();
      fillPhotoTaxonomy(fixture);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();

      expect(extractQuestionFromImage).not.toHaveBeenCalled();
    });

    it('on success: fills sBody/sAlternatives/sCorrectAnswer/sDifficulty, copies course/topic/grade from the photo tab, and switches to the structured tab', () => {
      const { fixture, compiled, getCourses, getTopics } = setup();
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      const instance = fixture.componentInstance as unknown as {
        sBody: () => string;
        sAlternatives: () => string;
        sCorrectAnswer: () => string;
        sDifficulty: () => string;
        sGradeLevel: () => string | null;
        sCourseId: () => string;
        sTopicId: () => string;
        tab: () => string;
        extracting: () => boolean;
      };
      expect(instance.sBody()).toBe('Enunciado desde imagen');
      expect(instance.sAlternatives()).toBe('Alt A extraída\nAlt B extraída');
      expect(instance.sCorrectAnswer()).toBe('1');
      expect(instance.sDifficulty()).toBe('easy');
      expect(instance.sGradeLevel()).toBe('pre');
      expect(getCourses).toHaveBeenCalledWith('pre');
      expect(instance.sCourseId()).toBe('c1');
      expect(getTopics).toHaveBeenCalledWith('c1', 'pre');
      expect(instance.sTopicId()).toBe('t1');
      expect(instance.tab()).toBe('structured');
      expect(instance.extracting()).toBe(false);
    });

    it('on error: sets extractError, stays on the photo tab, and resets extracting()', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      const instance = fixture.componentInstance as unknown as {
        extractError: () => string | null;
        tab: () => string;
        extracting: () => boolean;
      };
      expect(instance.extractError()).toBe('No se pudo leer la pregunta desde la imagen. Inténtalo de nuevo.');
      expect(instance.tab()).toBe('photo');
      expect(instance.extracting()).toBe(false);
    });
  });
});
