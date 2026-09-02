import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, it, expect, vi } from 'vitest';
import { Observable, Subject, TimeoutError, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { NormalizedBoxDto, AiExtractedQuestion } from '@exams-generator/shared';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { BankNewComponent } from './bank-new.component';
import { BankService } from '../bank.service';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { AiService } from '../../ai/ai.service';
import { AiRevisedQuestion } from '../../ai/ai.models';
import { CropSlot, CropTarget } from '../crop-review/crop-review.component';

const COURSES: Course[] = [
  { id: 'c1', name: 'Matemática', stage: 'preuniversitario' },
  { id: 'c2', name: 'Comunicación', stage: 'preuniversitario' },
];
const TOPICS_C1: Topic[] = [{ id: 't1', name: 'Álgebra', courseId: 'c1' }];
const TOPICS_C2: Topic[] = [{ id: 't2', name: 'Comprensión lectora', courseId: 'c2' }];

function setup(
  over: {
    uploadImpl?: () => unknown;
    structuredImpl?: () => unknown;
    replaceImageImpl?: () => unknown;
    getCourses?: () => unknown;
    getTopics?: (courseId: string) => unknown;
    extractQuestionFromImageImpl?: (image: File) => unknown;
    recropExtractionImpl?: (extractionId: string, box: NormalizedBoxDto) => unknown;
    setAlternativeImagesImpl?: (
      id: string,
      crops: readonly { alternativeIndex: number; file: File }[],
    ) => unknown;
  } = {},
) {
  const uploadImageQuestion = vi.fn(over.uploadImpl ?? (() => of({ id: 'img-q' })));
  const createStructuredQuestion = vi.fn(over.structuredImpl ?? (() => of({ id: 'str-q' })));
  const replaceQuestionImage = vi.fn(over.replaceImageImpl ?? (() => of({ id: 'str-q' })));
  const setAlternativeImages = vi.fn(over.setAlternativeImagesImpl ?? (() => of({ id: 'str-q' })));
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
  const recropExtraction = vi.fn(
    over.recropExtractionImpl ??
      (() => of({ dataUrl: 'data:image/png;base64,ZZZZ', box: { x: 0, y: 0, w: 0.2, h: 0.2 } })),
  );
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    imports: [BankNewComponent],
    providers: [
      {
        provide: BankService,
        useValue: {
          uploadImageQuestion,
          createStructuredQuestion,
          replaceQuestionImage,
          setAlternativeImages,
        },
      },
      { provide: TaxonomyService, useValue: { getCourses, getTopics } },
      { provide: AiService, useValue: { extractQuestionFromImage, recropExtraction } },
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
    replaceQuestionImage,
    setAlternativeImages,
    getCourses,
    getTopics,
    extractQuestionFromImage,
    recropExtraction,
    navigate,
  };
}

function set(
  fixture: { componentInstance: unknown; detectChanges(): void },
  prop: string,
  value: unknown,
) {
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
  return Array.from(container.querySelectorAll('[data-testid="select-option"]')).map((o) =>
    o.textContent?.trim(),
  );
}

/** The trigger button for the `ui-select` scoped under `testid` — mirrors the old `<select>` element for disabled checks. */
function selectTrigger(compiled: HTMLElement, testid: string): HTMLButtonElement {
  return compiled.querySelector(
    `[data-testid="${testid}"] button[role="combobox"]`,
  ) as HTMLButtonElement;
}

/**
 * Reads the `options()` bound to the `ui-select` scoped under `testid` directly off the
 * component instance — the DISABLED trigger can't be opened via click, so this is the
 * equivalent of reading a disabled native `<select>`'s (still-present) `<option>` list.
 */
function selectOptionsOf(
  fixture: { debugElement: { query(pred: unknown): { componentInstance: unknown } | null } },
  testid: string,
): readonly SelectOption<unknown>[] {
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

function pickStructuredImage(fixture: { detectChanges(): void }, compiled: HTMLElement): File {
  const file = new File(['bytes'], 'grafico.png', { type: 'image/png' });
  const nativeFileInput = compiled.querySelector(
    '[data-testid="tab-structured-panel"] input[type="file"]',
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
    const { fixture, compiled, createStructuredQuestion, replaceQuestionImage, navigate } = setup();
    (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    set(fixture, 'sGradeLevel', 'pre');
    set(fixture, 'sCourseId', 'c1');
    set(fixture, 'sTopicId', 't1');
    set(fixture, 'sDifficulty', 'easy');
    set(fixture, 'sBody', '¿Cuánto es 2+2?');
    set(fixture, 'sAlternatives', '4\n3\n5\n6');
    set(fixture, 'sCorrectAnswer', 'a');
    (
      compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
    ).click();
    expect(createStructuredQuestion).toHaveBeenCalledWith({
      courseId: 'c1',
      topicId: 't1',
      difficulty: 'easy',
      gradeLevel: 'pre',
      // Clave field is letter-labeled ('a') — wire format is the 0-based index ('0').
      correctAnswer: '0',
      bodyTypst: '¿Cuánto es 2+2?',
      alternatives: ['4', '3', '5', '6'],
    });
    // No complement image was picked — the second-step call must not fire.
    expect(replaceQuestionImage).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/app/bank']);
  });

  it('attaches a picked complement image after creating the structured question, then navigates back', () => {
    const { fixture, compiled, replaceQuestionImage, navigate } = setup();
    (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    set(fixture, 'sGradeLevel', 'pre');
    set(fixture, 'sCourseId', 'c1');
    set(fixture, 'sTopicId', 't1');
    set(fixture, 'sDifficulty', 'easy');
    set(fixture, 'sBody', 'Según el gráfico adjunto...');
    set(fixture, 'sAlternatives', 'a\nb');
    set(fixture, 'sCorrectAnswer', 'a');
    const file = pickStructuredImage(fixture, compiled);
    (
      compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
    ).click();

    expect(replaceQuestionImage).toHaveBeenCalledWith('str-q', file);
    expect(navigate).toHaveBeenCalledWith(['/app/bank']);
  });

  it('shows a partial-failure message when the question is created but the complement image fails to upload, and does not navigate', () => {
    const { fixture, compiled, navigate } = setup({
      replaceImageImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    });
    (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    set(fixture, 'sGradeLevel', 'pre');
    set(fixture, 'sCourseId', 'c1');
    set(fixture, 'sTopicId', 't1');
    set(fixture, 'sDifficulty', 'easy');
    set(fixture, 'sBody', 'Según el gráfico adjunto...');
    set(fixture, 'sAlternatives', 'a\nb');
    set(fixture, 'sCorrectAnswer', 'a');
    pickStructuredImage(fixture, compiled);
    (
      compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="save-error"]')?.textContent).toContain(
      'no se pudieron adjuntar las imágenes',
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('retrying after a failed image attach only re-attaches the image — never creates a duplicate question', () => {
    let attempt = 0;
    const { fixture, compiled, createStructuredQuestion, replaceQuestionImage, navigate } = setup({
      replaceImageImpl: () => {
        attempt++;
        return attempt === 1
          ? throwError(() => new HttpErrorResponse({ status: 500 }))
          : of({ id: 'str-q' });
      },
    });
    (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    set(fixture, 'sGradeLevel', 'pre');
    set(fixture, 'sCourseId', 'c1');
    set(fixture, 'sTopicId', 't1');
    set(fixture, 'sDifficulty', 'easy');
    set(fixture, 'sBody', 'Según el gráfico adjunto...');
    set(fixture, 'sAlternatives', 'a\nb');
    set(fixture, 'sCorrectAnswer', 'a');
    pickStructuredImage(fixture, compiled);

    // First submit: question is created, image attach fails.
    (
      compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(createStructuredQuestion).toHaveBeenCalledTimes(1);
    expect(replaceQuestionImage).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();

    // Retry: must NOT call createStructuredQuestion again, only retry the image attach.
    (
      compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(createStructuredQuestion).toHaveBeenCalledTimes(1);
    expect(replaceQuestionImage).toHaveBeenCalledTimes(2);
    expect(replaceQuestionImage).toHaveBeenLastCalledWith('str-q', expect.any(File));
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
    (
      compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
    ).click();
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
      expect(
        (fixture.componentInstance as unknown as { sCourseId: () => string }).sCourseId(),
      ).toBe('c1');

      set(fixture, 'sGradeLevel', 'esc');
      fixture.detectChanges();

      expect(getCourses).toHaveBeenNthCalledWith(2, 'esc');
      expect(
        (fixture.componentInstance as unknown as { sCourseId: () => string }).sCourseId(),
      ).toBe('');
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
      expect((fixture.componentInstance as unknown as { sTopicId: () => string }).sTopicId()).toBe(
        't1',
      );

      set(fixture, 'sCourseId', 'c2');
      fixture.detectChanges();

      expect(getTopics).toHaveBeenCalledWith('c2', 'pre');
      expect((fixture.componentInstance as unknown as { sTopicId: () => string }).sTopicId()).toBe(
        '',
      );
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
      (
        compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
      ).click();
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
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

      const nativeFileInput = compiled.querySelector(
        '[data-testid="tab-photo-panel"] input[type="file"]',
      ) as HTMLInputElement;
      Object.defineProperty(nativeFileInput, 'files', { value: [file] });
      nativeFileInput.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(createObjectURLSpy).toHaveBeenCalledWith(file);
      expect(
        compiled.querySelector('[data-testid="image-upload-filename"]')?.textContent,
      ).toContain('enunciado.png');
      expect(compiled.querySelector('[data-testid="image-upload-preview"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="image-upload-change"]')).toBeTruthy();
    });
  });

  describe('styled file upload (structured tab, complement image)', () => {
    it('renders an optional styled upload control, not the native file input', () => {
      const { fixture, compiled } = setup();
      (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      const structuredPanel = compiled.querySelector(
        '[data-testid="tab-structured-panel"]',
      ) as HTMLElement;
      expect(structuredPanel.querySelector('[data-testid="structured-image-upload"]')).toBeTruthy();
      const nativeFileInput = structuredPanel.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      expect(nativeFileInput).toBeTruthy();
      expect(nativeFileInput.classList.contains('sr-only')).toBe(true);
    });

    it('shows the chosen filename and a thumbnail preview after picking a complement image', () => {
      const { fixture, compiled } = setup();
      (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

      pickStructuredImage(fixture, compiled);

      expect(
        compiled.querySelector('[data-testid="structured-image-upload-filename"]')?.textContent,
      ).toContain('grafico.png');
      expect(
        compiled.querySelector('[data-testid="structured-image-upload-preview"]'),
      ).toBeTruthy();
      expect(compiled.querySelector('[data-testid="structured-image-upload-change"]')).toBeTruthy();
    });

    it('does not gate structuredValid() on the complement image — form stays submittable without it', () => {
      const { fixture, compiled } = setup();
      (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      set(fixture, 'sGradeLevel', 'pre');
      set(fixture, 'sCourseId', 'c1');
      set(fixture, 'sTopicId', 't1');
      set(fixture, 'sDifficulty', 'easy');
      set(fixture, 'sBody', 'x');
      set(fixture, 'sAlternatives', 'a\nb');
      set(fixture, 'sCorrectAnswer', 'a');

      expect(compiled.querySelector('[data-testid="structured-validation"]')).toBeFalsy();
      expect(
        (compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement)
          .disabled,
      ).toBe(false);
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

    it('on success: fills sBody/sAlternatives/sCorrectAnswer, copies the MANUALLY picked course/topic/grade from the photo tab, leaves Nivel untouched, and switches to the structured tab', () => {
      const { fixture, compiled, getCourses, getTopics } = setup();
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      const instance = fixture.componentInstance as unknown as {
        sBody: () => string;
        sAlternatives: () => string;
        sCorrectAnswer: () => string;
        sDifficulty: () => string | null;
        sGradeLevel: () => string | null;
        sCourseId: () => string;
        sTopicId: () => string;
        tab: () => string;
        extracting: () => boolean;
      };
      expect(instance.sBody()).toBe('Enunciado desde imagen');
      expect(instance.sAlternatives()).toBe('Alt A extraída\nAlt B extraída');
      // Mocked extract response returns index '1' (backend wire format) — UI shows the letter 'b'.
      expect(instance.sCorrectAnswer()).toBe('b');
      // Nivel is a human call, never auto-filled from AI — stays whatever it already was (null, never touched).
      expect(instance.sDifficulty()).toBe(null);
      expect(instance.sGradeLevel()).toBe('pre');
      expect(getCourses).toHaveBeenCalledWith('pre');
      expect(instance.sCourseId()).toBe('c1');
      expect(getTopics).toHaveBeenCalledWith('c1', 'pre');
      expect(instance.sTopicId()).toBe('t1');
      expect(instance.tab()).toBe('structured');
      expect(instance.extracting()).toBe(false);
    });

    it('enables extraction with ONLY Grado + imagen (no Curso/Tema/Nivel picked), and matches the AI-suggested course/topic against the loaded taxonomy', () => {
      const { fixture, compiled, getCourses, getTopics } = setup({
        extractQuestionFromImageImpl: () =>
          of({
            bodyTypst: 'Enunciado desde imagen',
            alternatives: ['A', 'B'],
            correctAnswer: '0',
            suggestedCourseName: 'comunicación', // lowercase/accented on purpose — must still match "Comunicación" (c2)
            suggestedTopicName: 'lectora', // partial — must still match "Comprensión lectora" (t2) via substring
          } satisfies AiRevisedQuestion),
      });
      set(fixture, 'pGradeLevel', 'pre');
      pickImage(fixture, compiled);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      const instance = fixture.componentInstance as unknown as {
        sCourseId: () => string;
        sTopicId: () => string;
        sDifficulty: () => string | null;
        tab: () => string;
      };
      expect(getCourses).toHaveBeenCalledWith('pre');
      expect(instance.sCourseId()).toBe('c2');
      expect(getTopics).toHaveBeenCalledWith('c2', 'pre');
      expect(instance.sTopicId()).toBe('t2');
      expect(instance.sDifficulty()).toBe(null);
      expect(instance.tab()).toBe('structured');
    });

    it('leaves Curso/Tema blank when the AI suggestion matches nothing in the loaded taxonomy', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () =>
          of({
            bodyTypst: 'Enunciado desde imagen',
            alternatives: ['A', 'B'],
            correctAnswer: '0',
            suggestedCourseName: 'Curso Inexistente',
            suggestedTopicName: 'Tema inexistente',
          } satisfies AiRevisedQuestion),
      });
      set(fixture, 'pGradeLevel', 'pre');
      pickImage(fixture, compiled);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      const instance = fixture.componentInstance as unknown as {
        sCourseId: () => string;
        sTopicId: () => string;
      };
      expect(instance.sCourseId()).toBe('');
      expect(instance.sTopicId()).toBe('');
    });

    it('on error: sets extractError, stays on the photo tab, and resets extracting()', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () =>
          throwError(() => new HttpErrorResponse({ status: 500 })),
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
      expect(instance.extractError()).toBe(
        'No se pudo leer la pregunta desde la imagen. Inténtalo de nuevo.',
      );
      expect(instance.tab()).toBe('photo');
      expect(instance.extracting()).toBe(false);
    });

    it('surfaces a 4xx body verbatim instead of the generic retry message', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () =>
          throwError(
            () =>
              new HttpErrorResponse({
                status: 422,
                error: {
                  message: ['alternatives must be an array of exactly 5 non-empty strings'],
                },
              }),
          ),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      const instance = fixture.componentInstance as unknown as {
        extractError: () => string | null;
      };
      // Retrying never fixes a 422 — the teacher has to see WHY it failed.
      expect(instance.extractError()).toBe(
        'alternatives must be an array of exactly 5 non-empty strings',
      );
    });

    it('keeps the free-tier wording for a 429, whose body explains nothing', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () =>
          throwError(() => new HttpErrorResponse({ status: 429 })),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      const instance = fixture.componentInstance as unknown as {
        extractError: () => string | null;
      };
      expect(instance.extractError()).toContain('límite de uso gratuito');
    });

    it('does not leak a stale pending course/topic when the structured grade already equals the photo grade (same-grade no-op)', () => {
      const { fixture, compiled } = setup();
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      set(fixture, 'sGradeLevel', 'pre');

      const instance = fixture.componentInstance as unknown as {
        extractWithAi(): void;
        sGradeLevel: () => string | null;
        sCourseId: () => string;
        sTopicId: () => string;
      };
      instance.extractWithAi();
      fixture.detectChanges();

      // Same-grade no-op: sGradeLevel.set() never notifies, so the
      // grade→course effect doesn't fire and Curso/Tema are NOT preselected.
      expect(instance.sGradeLevel()).toBe('pre');
      expect(instance.sCourseId()).not.toBe('c1');
      expect(instance.sTopicId()).not.toBe('t1');

      // Later manual course pick on the structured tab, unrelated to the
      // photo tab's course — without Fix 1's guard, pendingStructuredTopicId
      // would still hold the photo tab's stale 't1' and leak into c2.
      set(fixture, 'sCourseId', 'c2');
      fixture.detectChanges();

      expect(instance.sTopicId()).toBe('');
    });
  });

  describe('extract-with-ai button (photo tab)', () => {
    it('is disabled until photo taxonomy + image are complete, then enabled', () => {
      const { fixture, compiled } = setup();
      const button = compiled.querySelector(
        '[data-testid="extract-with-ai"] button',
      ) as HTMLButtonElement;
      expect(button.disabled).toBe(true);

      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      expect(button.disabled).toBe(false);
    });

    it('clicking it runs extractWithAi and lands on the structured tab with the extracted question', () => {
      const { fixture, compiled } = setup();
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      (
        compiled.querySelector('[data-testid="extract-with-ai"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="tab-structured-panel"]')).toBeTruthy();
      const textarea = compiled.querySelector(
        '[data-testid="tab-structured-panel"] textarea',
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe('Enunciado desde imagen');
    });

    it('shows extract-error inline on failure, without leaving the photo tab', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () =>
          throwError(() => new HttpErrorResponse({ status: 500 })),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      (
        compiled.querySelector('[data-testid="extract-with-ai"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="extract-error"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="tab-photo-panel"]')).toBeTruthy();
    });
  });

  describe('AI crops', () => {
    const EXTRACTED_WITH_CROPS: AiExtractedQuestion = {
      bodyTypst: '¿Qué muestra la figura?',
      alternatives: ['a', 'b', 'c', 'd', 'e'],
      correctAnswer: '0',
      extractionId: 'extraction-1',
      figureCrop: {
        dataUrl: 'data:image/png;base64,AAAA',
        box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
      },
      alternativeCrops: [
        {
          alternativeIndex: 0,
          dataUrl: 'data:image/png;base64,BBBB',
          box: { x: 0, y: 0.7, w: 0.1, h: 0.1 },
        },
        {
          alternativeIndex: 2,
          dataUrl: 'data:image/png;base64,CCCC',
          box: { x: 0.3, y: 0.7, w: 0.1, h: 0.1 },
        },
      ],
    };

    function extractInto(fixture: { componentInstance: unknown; detectChanges(): void }): void {
      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();
    }

    it('renders no crop review when the extraction returned no crops', () => {
      const { fixture, compiled } = setup(); // default extracted carries neither figureCrop nor alternativeCrops
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      extractInto(fixture);

      expect(compiled.querySelector('app-crop-review')).toBeNull();
    });

    it('renders the crop review and builds one slot per returned crop, labelled by alternative letter', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () => of(EXTRACTED_WITH_CROPS),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      extractInto(fixture);

      // Companion to the "no crops" test above: proves crop review actually
      // renders when crops ARE present, so neither test passes against a
      // component that never renders it.
      expect(compiled.querySelector('app-crop-review')).toBeTruthy();
      const instance = fixture.componentInstance as unknown as {
        cropSlots(): readonly CropSlot[];
      };
      expect(instance.cropSlots().map((slot) => slot.label)).toEqual([
        'Figura del enunciado',
        'Alternativa a)',
        'Alternativa c)',
      ]);
    });

    it('replaces a slot with the API result after a manual re-crop', () => {
      const { fixture, compiled, recropExtraction } = setup({
        extractQuestionFromImageImpl: () => of(EXTRACTED_WITH_CROPS),
        recropExtractionImpl: () =>
          of({ dataUrl: 'data:image/png;base64,ZZZZ', box: { x: 0, y: 0, w: 0.2, h: 0.2 } }),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      extractInto(fixture);

      const instance = fixture.componentInstance as unknown as {
        onRecrop(event: { target: CropTarget; box: NormalizedBoxDto }): void;
        cropSlots(): readonly CropSlot[];
      };
      instance.onRecrop({ target: { kind: 'figure' }, box: { x: 0, y: 0, w: 0.2, h: 0.2 } });
      fixture.detectChanges();

      expect(recropExtraction).toHaveBeenCalledWith('extraction-1', { x: 0, y: 0, w: 0.2, h: 0.2 });
      expect(instance.cropSlots()[0]!.dataUrl).toBe('data:image/png;base64,ZZZZ');
      expect(instance.cropSlots()[0]!.busy).toBe(false);
    });

    it('translates a 410 from the re-crop endpoint into an expired-session message, rendered visibly next to the crop review', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () => of(EXTRACTED_WITH_CROPS),
        recropExtractionImpl: () => throwError(() => new HttpErrorResponse({ status: 410 })),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      extractInto(fixture);

      const instance = fixture.componentInstance as unknown as {
        onRecrop(event: { target: CropTarget; box: NormalizedBoxDto }): void;
        extractError(): string | null;
        cropSlots(): readonly CropSlot[];
      };
      instance.onRecrop({ target: { kind: 'figure' }, box: { x: 0, y: 0, w: 0.2, h: 0.2 } });
      fixture.detectChanges();

      expect(instance.extractError()).toBe(
        'La sesión de recorte expiró. Vuelve a extraer la pregunta desde la foto.',
      );
      expect(instance.cropSlots()[0]!.busy).toBe(false);
      // The signal alone proves nothing if it's never rendered anywhere the
      // teacher can read it — assert the DOM text, not just the signal.
      expect(compiled.querySelector('[data-testid="extract-error"]')?.textContent).toContain(
        'La sesión de recorte expiró',
      );
    });

    it('translates any other re-crop failure status into the generic retry message', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () => of(EXTRACTED_WITH_CROPS),
        recropExtractionImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      extractInto(fixture);

      const instance = fixture.componentInstance as unknown as {
        onRecrop(event: { target: CropTarget; box: NormalizedBoxDto }): void;
        extractError(): string | null;
      };
      instance.onRecrop({ target: { kind: 'figure' }, box: { x: 0, y: 0, w: 0.2, h: 0.2 } });
      fixture.detectChanges();

      expect(instance.extractError()).toBe('No se pudo recortar. Inténtalo de nuevo.');
      expect(compiled.querySelector('[data-testid="extract-error"]')?.textContent).toContain(
        'No se pudo recortar',
      );
    });

    it('drops a slot the teacher discarded so it is never uploaded', () => {
      const { fixture, compiled, setAlternativeImages } = setup({
        extractQuestionFromImageImpl: () => of(EXTRACTED_WITH_CROPS),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      extractInto(fixture);

      const instance = fixture.componentInstance as unknown as {
        onDiscard(target: CropTarget): void;
        cropSlots(): readonly CropSlot[];
      };
      instance.onDiscard({ kind: 'alternative', alternativeIndex: 2 });
      fixture.detectChanges();

      expect(instance.cropSlots().map((slot) => slot.label)).toEqual([
        'Figura del enunciado',
        'Alternativa a)',
      ]);

      // The discard must also be reflected in what actually gets uploaded —
      // not merely in the slot list shown to the teacher.
      set(fixture, 'sDifficulty', 'easy');
      (
        compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
      ).click();

      expect(setAlternativeImages).toHaveBeenCalledWith('str-q', [
        { alternativeIndex: 0, file: expect.any(File) },
      ]);
    });

    it('discarding the figure crop also clears sImage, so the complement image upload is skipped', () => {
      const { fixture, compiled, replaceQuestionImage } = setup({
        extractQuestionFromImageImpl: () => of(EXTRACTED_WITH_CROPS),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      extractInto(fixture);

      const instance = fixture.componentInstance as unknown as {
        onDiscard(target: CropTarget): void;
      };
      instance.onDiscard({ kind: 'figure' });
      fixture.detectChanges();
      set(fixture, 'sDifficulty', 'easy');
      (
        compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
      ).click();

      expect(replaceQuestionImage).not.toHaveBeenCalled();
    });

    it('uploads the figure crop and the alternative crops after creating the question', () => {
      const {
        fixture,
        compiled,
        createStructuredQuestion,
        replaceQuestionImage,
        setAlternativeImages,
      } = setup({
        extractQuestionFromImageImpl: () => of(EXTRACTED_WITH_CROPS),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      extractInto(fixture);
      set(fixture, 'sDifficulty', 'easy');

      (
        compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
      ).click();

      expect(createStructuredQuestion).toHaveBeenCalled();
      expect(replaceQuestionImage).toHaveBeenCalledWith('str-q', expect.any(File));
      // If the alternative index were taken from array POSITION rather than
      // from each slot's own target, this sparse [0, 2] set would come back
      // as [0, 1] instead — this assertion would then fail.
      expect(setAlternativeImages).toHaveBeenCalledWith('str-q', [
        { alternativeIndex: 0, file: expect.any(File) },
        { alternativeIndex: 2, file: expect.any(File) },
      ]);
    });

    it('keeps the created question and shows an actionable error when an image upload fails', () => {
      let attempt = 0;
      const { fixture, compiled, createStructuredQuestion, setAlternativeImages } = setup({
        extractQuestionFromImageImpl: () => of(EXTRACTED_WITH_CROPS),
        setAlternativeImagesImpl: () => {
          attempt++;
          return attempt === 1
            ? throwError(() => new HttpErrorResponse({ status: 500 }))
            : of({ id: 'str-q' });
        },
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      extractInto(fixture);
      set(fixture, 'sDifficulty', 'easy');

      (
        compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      const instance = fixture.componentInstance as unknown as {
        saveError(): string | null;
        submitStructured(): void;
      };
      expect(instance.saveError()).toContain('La pregunta se guardó');
      expect(createStructuredQuestion).toHaveBeenCalledTimes(1);

      // Retry must not create a second question — it retries only the
      // upload, against the SAME question id, proving the id was retained
      // rather than just re-showing the same message text.
      instance.submitStructured();
      fixture.detectChanges();
      expect(createStructuredQuestion).toHaveBeenCalledTimes(1);
      expect(setAlternativeImages).toHaveBeenLastCalledWith('str-q', expect.any(Array));
    });
  });

  describe('Critical 1: crop re-attribution when alternatives are edited after extraction', () => {
    const EXTRACTED_WITH_REAL_TEXT: AiExtractedQuestion = {
      bodyTypst: '¿Qué figura se muestra?',
      alternatives: ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'],
      correctAnswer: '0',
      extractionId: 'extraction-1',
      figureCrop: {
        dataUrl: 'data:image/png;base64,AAAA',
        box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
      },
      alternativeCrops: [
        {
          alternativeIndex: 0,
          dataUrl: 'data:image/png;base64,BBBB',
          box: { x: 0, y: 0.7, w: 0.1, h: 0.1 },
        },
        {
          alternativeIndex: 2,
          dataUrl: 'data:image/png;base64,CCCC',
          box: { x: 0.3, y: 0.7, w: 0.1, h: 0.1 },
        },
      ],
    };

    function extractInto(fixture: { componentInstance: unknown; detectChanges(): void }): void {
      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();
    }

    it('re-derives crop indices by original text when the teacher deletes a line before the crop, so the crop follows its alternative instead of misattaching', () => {
      const { fixture, compiled, setAlternativeImages } = setup({
        extractQuestionFromImageImpl: () => of(EXTRACTED_WITH_REAL_TEXT),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      extractInto(fixture);
      set(fixture, 'sDifficulty', 'easy');

      // Teacher deletes the "Dos" line (index 1). Alternatives collapse to
      // ['Uno', 'Tres', 'Cuatro', 'Cinco'] — 'Tres' (originally index 2, one
      // of the crop targets) now sits at index 1. Without re-derivation, the
      // frozen index 2 would misattach this crop to 'Cuatro'.
      set(fixture, 'sAlternatives', 'Uno\nTres\nCuatro\nCinco');

      (
        compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
      ).click();

      expect(setAlternativeImages).toHaveBeenCalledWith('str-q', [
        { alternativeIndex: 0, file: expect.any(File) }, // 'Uno' — unchanged position
        { alternativeIndex: 1, file: expect.any(File) }, // 'Tres' — shifted from 2 to 1
      ]);
    });

    it('drops a crop whose alternative was blanked (drawing-only convention) rather than misattaching it to whatever now occupies its old index', () => {
      const { fixture, compiled, setAlternativeImages } = setup({
        extractQuestionFromImageImpl: () => of(EXTRACTED_WITH_REAL_TEXT),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      extractInto(fixture);
      set(fixture, 'sDifficulty', 'easy');

      // Teacher blanks the 'Tres' line (index 2) per the pdf-template
      // convention ("an alternative with its own image carries no text").
      // `alternativesList()` filters blank lines, so 'Tres' disappears
      // entirely from the submitted array — its crop must be dropped, not
      // reattached to 'Cuatro' (which slides into its old index).
      set(fixture, 'sAlternatives', 'Uno\nDos\n\nCuatro\nCinco');

      (
        compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
      ).click();

      expect(setAlternativeImages).toHaveBeenCalledWith('str-q', [
        { alternativeIndex: 0, file: expect.any(File) }, // 'Uno' still matches
      ]);
    });

    it('uploads both crops unchanged when the alternatives were never edited (no regression)', () => {
      const { fixture, compiled, setAlternativeImages } = setup({
        extractQuestionFromImageImpl: () => of(EXTRACTED_WITH_REAL_TEXT),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      extractInto(fixture);
      set(fixture, 'sDifficulty', 'easy');

      (
        compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
      ).click();

      expect(setAlternativeImages).toHaveBeenCalledWith('str-q', [
        { alternativeIndex: 0, file: expect.any(File) },
        { alternativeIndex: 2, file: expect.any(File) },
      ]);
    });

    it('keeps a crop on its own alternative when the text is DUPLICATED elsewhere and nothing was edited (regression: text-only matching would move it to the wrong duplicate)', () => {
      // Duplicate numeric alternatives are not exotic in a maths bank — "2"
      // appears at both index 0 and index 2. The crop is frozen at index 2.
      // Matching by text ALONE (ignoring the frozen index) would find the
      // FIRST "2" (index 0) and misattach the crop there — with NO teacher
      // edit at all. Identity (index 2 still holds "2") must win first.
      const EXTRACTED_WITH_DUPLICATE_TEXT: AiExtractedQuestion = {
        bodyTypst: '¿Cuál es el valor correcto?',
        alternatives: ['2', '4', '2', '8'],
        correctAnswer: '0',
        extractionId: 'extraction-1',
        figureCrop: {
          dataUrl: 'data:image/png;base64,AAAA',
          box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
        },
        alternativeCrops: [
          {
            alternativeIndex: 2,
            dataUrl: 'data:image/png;base64,CCCC',
            box: { x: 0.3, y: 0.7, w: 0.1, h: 0.1 },
          },
        ],
      };
      const { fixture, compiled, setAlternativeImages } = setup({
        extractQuestionFromImageImpl: () => of(EXTRACTED_WITH_DUPLICATE_TEXT),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      extractInto(fixture);
      set(fixture, 'sDifficulty', 'easy');
      // No edit to sAlternatives — it stays exactly as extracted.

      (
        compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
      ).click();

      expect(setAlternativeImages).toHaveBeenCalledWith('str-q', [
        { alternativeIndex: 2, file: expect.any(File) }, // must stay at 2, not jump to 0
      ]);
    });
  });

  describe('Important 2: the complement-image preview stays synced with what actually uploads', () => {
    it('shows a preview for the AI figure crop right after extraction (not blank)', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () =>
          of({
            bodyTypst: 'x',
            alternatives: ['a', 'b'],
            correctAnswer: '0',
            extractionId: 'extraction-1',
            figureCrop: {
              dataUrl: 'data:image/png;base64,AAAA',
              box: { x: 0, y: 0, w: 0.2, h: 0.2 },
            },
          } satisfies AiExtractedQuestion),
      });
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      expect(
        compiled.querySelector('[data-testid="structured-image-upload-preview"]'),
      ).toBeTruthy();
    });

    it('updates the preview after a manual re-crop of the figure', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () =>
          of({
            bodyTypst: 'x',
            alternatives: ['a', 'b'],
            correctAnswer: '0',
            extractionId: 'extraction-1',
            figureCrop: {
              dataUrl: 'data:image/png;base64,AAAA',
              box: { x: 0, y: 0, w: 0.2, h: 0.2 },
            },
          } satisfies AiExtractedQuestion),
        recropExtractionImpl: () =>
          of({ dataUrl: 'data:image/png;base64,ZZZZ', box: { x: 0, y: 0, w: 0.2, h: 0.2 } }),
      });
      let urlCount = 0;
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake-url-${++urlCount}`);
      const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();
      const urlAfterExtract = compiled
        .querySelector('[data-testid="structured-image-upload-preview"]')
        ?.getAttribute('src');

      (
        fixture.componentInstance as unknown as {
          onRecrop(event: { target: CropTarget; box: NormalizedBoxDto }): void;
        }
      ).onRecrop({ target: { kind: 'figure' }, box: { x: 0, y: 0, w: 0.2, h: 0.2 } });
      fixture.detectChanges();

      const urlAfterRecrop = compiled
        .querySelector('[data-testid="structured-image-upload-preview"]')
        ?.getAttribute('src');
      expect(urlAfterRecrop).toBeTruthy();
      expect(urlAfterRecrop).not.toBe(urlAfterExtract);
      // The stale object URL from extraction must be revoked, not leaked.
      expect(revokeSpy).toHaveBeenCalledWith(urlAfterExtract);
    });

    it('clears the preview when the figure crop is discarded', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () =>
          of({
            bodyTypst: 'x',
            alternatives: ['a', 'b'],
            correctAnswer: '0',
            extractionId: 'extraction-1',
            figureCrop: {
              dataUrl: 'data:image/png;base64,AAAA',
              box: { x: 0, y: 0, w: 0.2, h: 0.2 },
            },
          } satisfies AiExtractedQuestion),
      });
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      (fixture.componentInstance as unknown as { onDiscard(target: CropTarget): void }).onDiscard({
        kind: 'figure',
      });
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="structured-image-upload-preview"]')).toBeFalsy();
    });
  });

  describe('Important 3: switching the photo clears stale crops and the AI-derived complement image', () => {
    const EXTRACTED_WITH_CROPS_2: AiExtractedQuestion = {
      bodyTypst: '¿Qué muestra la figura?',
      alternatives: ['a', 'b', 'c', 'd', 'e'],
      correctAnswer: '0',
      extractionId: 'extraction-1',
      figureCrop: {
        dataUrl: 'data:image/png;base64,AAAA',
        box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
      },
      alternativeCrops: [
        {
          alternativeIndex: 0,
          dataUrl: 'data:image/png;base64,BBBB',
          box: { x: 0, y: 0.7, w: 0.1, h: 0.1 },
        },
      ],
    };

    it('clears cropSlots, extractionId and the AI-derived sImage when a new photo is picked on the photo tab', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () => of(EXTRACTED_WITH_CROPS_2),
      });
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      const instance = fixture.componentInstance as unknown as {
        cropSlots(): readonly unknown[];
        sImage(): File | null;
      };
      expect(instance.cropSlots().length).toBeGreaterThan(0);
      expect(instance.sImage()).not.toBeNull();

      // Back on the photo tab, teacher picks a DIFFERENT photo.
      (compiled.querySelector('[data-testid="tab-photo"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      pickImage(fixture, compiled);

      expect(instance.cropSlots().length).toBe(0);
      expect(instance.sImage()).toBeNull();
    });

    it('a manually picked complement image survives a photo change (never came from a crop)', () => {
      const { fixture, compiled } = setup();
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      const manualFile = pickStructuredImage(fixture, compiled);

      (compiled.querySelector('[data-testid="tab-photo"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      pickImage(fixture, compiled);

      const instance = fixture.componentInstance as unknown as { sImage(): File | null };
      expect(instance.sImage()).toBe(manualFile);
    });

    it('a stale crop is never uploaded after the photo was swapped and no new extraction ran', () => {
      const { fixture, compiled, replaceQuestionImage, setAlternativeImages } = setup({
        extractQuestionFromImageImpl: () => of(EXTRACTED_WITH_CROPS_2),
      });
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="tab-photo"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      pickImage(fixture, compiled);
      (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      set(fixture, 'sDifficulty', 'easy');

      (
        compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
      ).click();

      expect(replaceQuestionImage).not.toHaveBeenCalled();
      expect(setAlternativeImages).not.toHaveBeenCalled();
    });
  });

  describe('B1: empty alternatives / null correctAnswer from extraction', () => {
    it('shows a non-error notice and leaves the alternatives textarea empty and focused when extraction returns no alternatives', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () =>
          of({
            bodyTypst: 'Enunciado sin alternativas',
            alternatives: [],
            correctAnswer: '0',
          }),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      const notice = compiled.querySelector('[data-testid="extract-no-alternatives"]');
      expect(notice?.textContent).toContain(
        'La foto no trae alternativas. Escríbelas una por línea.',
      );
      const instance = fixture.componentInstance as unknown as { sAlternatives(): string };
      expect(instance.sAlternatives()).toBe('');
      const textarea = compiled.querySelector(
        '[data-testid="structured-alternatives-textarea"]',
      ) as HTMLTextAreaElement;
      expect(document.activeElement).toBe(textarea);
    });

    it('hides the empty-alternatives notice when the extraction did return alternatives', () => {
      const { fixture, compiled } = setup();
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="extract-no-alternatives"]')).toBeFalsy();
    });

    it('leaves the clave input empty (never prefilled) when correctAnswer is null', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () =>
          of({
            bodyTypst: 'x',
            alternatives: ['a', 'b'],
            correctAnswer: null,
          }),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      const instance = fixture.componentInstance as unknown as { sCorrectAnswer(): string };
      expect(instance.sCorrectAnswer()).toBe('');
    });
  });

  describe('B2: client timeout on extract', () => {
    it('shows the progress status line while extracting, hidden the rest of the time', () => {
      const { fixture, compiled } = setup({
        // Never emits/errors — simulates a still-in-flight request.
        extractQuestionFromImageImpl: () => new Observable(() => {}),
      });
      expect(compiled.querySelector('[data-testid="extract-progress"]')).toBeFalsy();
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      const status = compiled.querySelector('[data-testid="extract-progress"]');
      expect(status?.textContent).toContain('Leyendo la foto… puede tardar hasta un minuto.');
    });

    it('on a client-side timeout, shows the specific timeout message and re-enables the button', () => {
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () => throwError(() => new TimeoutError()),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);

      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      const instance = fixture.componentInstance as unknown as {
        extractError(): string | null;
        extracting(): boolean;
      };
      expect(instance.extractError()).toBe(
        'La lectura de la foto tardó demasiado. Inténtalo de nuevo.',
      );
      expect(instance.extracting()).toBe(false);
      const button = compiled.querySelector(
        '[data-testid="extract-with-ai"] button',
      ) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });
  });

  describe('B3: stale recrop guard', () => {
    const EXTRACTED_WITH_FIGURE_CROP: AiExtractedQuestion = {
      bodyTypst: '¿Qué muestra la figura?',
      alternatives: ['a', 'b'],
      correctAnswer: '0',
      extractionId: 'extraction-1',
      figureCrop: {
        dataUrl: 'data:image/png;base64,AAAA',
        box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
      },
    };

    it('ignores a recrop response whose captured extractionId no longer matches the current extraction (photo swapped mid-recrop)', () => {
      const recropSubject = new Subject<{ dataUrl: string; box: NormalizedBoxDto }>();
      const { fixture, compiled } = setup({
        extractQuestionFromImageImpl: () => of(EXTRACTED_WITH_FIGURE_CROP),
        recropExtractionImpl: () => recropSubject.asObservable(),
      });
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      const instance = fixture.componentInstance as unknown as {
        onRecrop(event: { target: CropTarget; box: NormalizedBoxDto }): void;
        cropSlots(): readonly CropSlot[];
        sImage(): File | null;
        extractError(): string | null;
      };
      instance.onRecrop({ target: { kind: 'figure' }, box: { x: 0, y: 0, w: 0.2, h: 0.2 } });
      fixture.detectChanges();

      // Photo swapped mid-recrop — resets extractionId/cropSlots/sImage
      // (Important Finding 3), same as if the teacher gave up on this
      // extraction entirely.
      (compiled.querySelector('[data-testid="tab-photo"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      pickImage(fixture, compiled);

      expect(instance.cropSlots().length).toBe(0);
      expect(instance.sImage()).toBeNull();

      // The OLD extraction's recrop finally resolves.
      recropSubject.next({
        dataUrl: 'data:image/png;base64,ZZZZ',
        box: { x: 0, y: 0, w: 0.2, h: 0.2 },
      });
      fixture.detectChanges();

      expect(instance.cropSlots().length).toBe(0);
      expect(instance.sImage()).toBeNull();
      expect(instance.extractError()).toBeNull();
    });
  });

  describe('Minor 7: a re-crop attempted after a failed cache write shows feedback instead of doing nothing', () => {
    it('shows the expired-session message and never calls the API when extractionId is null', () => {
      const { fixture, compiled, recropExtraction } = setup({
        // hasCrops but no extractionId — the cache.put-failure path, which by
        // design still returns crops.
        extractQuestionFromImageImpl: () =>
          of({
            bodyTypst: 'x',
            alternatives: ['a', 'b'],
            correctAnswer: '0',
            figureCrop: {
              dataUrl: 'data:image/png;base64,AAAA',
              box: { x: 0, y: 0, w: 0.2, h: 0.2 },
            },
          } satisfies AiExtractedQuestion),
      });
      fillPhotoTaxonomy(fixture);
      pickImage(fixture, compiled);
      (fixture.componentInstance as unknown as { extractWithAi(): void }).extractWithAi();
      fixture.detectChanges();

      const instance = fixture.componentInstance as unknown as {
        onRecrop(event: { target: CropTarget; box: NormalizedBoxDto }): void;
        extractError(): string | null;
      };
      instance.onRecrop({ target: { kind: 'figure' }, box: { x: 0, y: 0, w: 0.2, h: 0.2 } });
      fixture.detectChanges();

      expect(recropExtraction).not.toHaveBeenCalled();
      expect(instance.extractError()).toBe(
        'La sesión de recorte expiró. Vuelve a extraer la pregunta desde la foto.',
      );
      expect(compiled.querySelector('[data-testid="extract-error"]')?.textContent).toContain(
        'La sesión de recorte expiró',
      );
    });
  });
});
