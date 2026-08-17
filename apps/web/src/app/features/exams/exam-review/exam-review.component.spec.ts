import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { Difficulty } from '@exams-generator/shared';
import { ExamReviewComponent } from './exam-review.component';
import { ExamsService } from '../exams.service';
import { ExamVersionsService } from '../../exam-versions/exam-versions.service';
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
      courseName: 'Aritmética',
      topicId: 'topic-1',
      topicName: 'Teoría de conjuntos',
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
      courseName: 'Álgebra',
      topicId: 'topic-2',
      topicName: 'Ecuaciones',
      difficulty: Difficulty.Hard,
      correctAnswer: 'b',
      imageAssetId: 'asset-2',
      bodyTypst: null,
      alternatives: null,
      figureCode: null,
    },
  ],
};

/** `type='structured'`: `correctAnswer` is the 0-based INDEX into `alternatives`, not a letter. */
const STRUCTURED_EXAM: ExamDetail = {
  ...EXAM,
  questions: [
    {
      id: 'q1',
      position: 0,
      type: 'structured',
      courseId: 'course-1',
      courseName: 'Aritmética',
      topicId: 'topic-1',
      topicName: 'Teoría de conjuntos',
      difficulty: Difficulty.Medium,
      correctAnswer: '2',
      imageAssetId: null,
      bodyTypst: '¿Cuántos elementos tiene $A = {1, 2, 3}$?',
      alternatives: ['1', '2', '3', '4', '5'],
      figureCode: null,
    },
  ],
};

function setup(overrides: {
  getExam?: (id: string) => unknown;
  replaceQuestion?: (...args: unknown[]) => unknown;
  confirmExam?: (...args: unknown[]) => unknown;
  generateVersions?: (...args: unknown[]) => unknown;
  /** `?formas=N` — the count the builder carries over (product decision 2026-08-17). */
  formas?: string;
}) {
  const getExam = vi.fn(overrides.getExam ?? (() => of(EXAM)));
  const replaceQuestion = vi.fn(
    overrides.replaceQuestion ?? (() => of({ examId: 'exam-1', oldQuestionId: 'q1', newQuestionId: 'q3' })),
  );
  const confirmExam = vi.fn(overrides.confirmExam ?? (() => of({ id: 'exam-1', status: 'ready' })));
  const generateVersions = vi.fn(
    overrides.generateVersions ??
      (() => of({ id: 'job-1', examId: 'exam-1', versionCount: 2, status: 'pending', completedCount: 0 })),
  );
  const navigate = vi.fn();

  TestBed.configureTestingModule({
    imports: [ExamReviewComponent],
    providers: [
      { provide: ExamsService, useValue: { getExam, replaceQuestion, confirmExam } },
      { provide: ExamVersionsService, useValue: { generateVersions } },
      { provide: Router, useValue: { navigate } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap({ examId: 'exam-1' }),
            queryParamMap: convertToParamMap(overrides.formas ? { formas: overrides.formas } : {}),
          },
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(ExamReviewComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  return { fixture, compiled, getExam, replaceQuestion, confirmExam, generateVersions, navigate };
}

describe('ExamReviewComponent', () => {
  /**
   * Producto decidió (2026-08-17) la opción (a) del audit 2026-08-15: el
   * builder ya no genera, esta pantalla sí. Es la única donde las preguntas se
   * leen, así que es la única donde tiene sentido sellar el examen.
   */
  describe('generar las formas desde acá (el paso que el builder ya no hace)', () => {
    it('genera con la cantidad que trajo el builder en ?formas y va a la pantalla de formas', () => {
      const { compiled, fixture, generateVersions, navigate } = setup({ formas: '4' });

      const button = compiled.querySelector<HTMLButtonElement>('[data-testid="generate-from-review"] button')!;
      expect(button.textContent).toContain('4');

      button.click();
      fixture.detectChanges();

      expect(generateVersions).toHaveBeenCalledWith('exam-1', 4);
      expect(navigate).toHaveBeenCalledWith(['/app/exams', 'exam-1', 'versions']);
    });

    it('usa 2 formas cuando no viene ?formas (entrada directa por URL o desde la lista)', () => {
      const { compiled, fixture, generateVersions } = setup({});

      compiled.querySelector<HTMLButtonElement>('[data-testid="generate-from-review"] button')!.click();
      fixture.detectChanges();

      expect(generateVersions).toHaveBeenCalledWith('exam-1', 2);
    });

    it('ignora un ?formas basura en vez de mandar NaN al backend', () => {
      const { compiled, fixture, generateVersions } = setup({ formas: 'muchas' });

      compiled.querySelector<HTMLButtonElement>('[data-testid="generate-from-review"] button')!.click();
      fixture.detectChanges();

      expect(generateVersions).toHaveBeenCalledWith('exam-1', 2);
    });

    it('permite cambiar la cantidad acá mismo antes de generar', () => {
      const { compiled, fixture, generateVersions } = setup({ formas: '2' });

      const container = compiled.querySelector('[data-testid="review-version-count"]') as HTMLElement;
      (container.querySelector('button[role="combobox"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      const option = Array.from(container.querySelectorAll('[data-testid="select-option"]')).find(
        (li) => li.textContent?.trim() === '5',
      ) as HTMLElement;
      option.click();
      fixture.detectChanges();

      compiled.querySelector<HTMLButtonElement>('[data-testid="generate-from-review"] button')!.click();
      fixture.detectChanges();

      expect(generateVersions).toHaveBeenCalledWith('exam-1', 5);
    });

    it('avisa y no navega cuando la generación es rechazada', () => {
      const { compiled, fixture, navigate } = setup({
        generateVersions: () => throwError(() => new HttpErrorResponse({ status: 409, error: {} })),
      });

      compiled.querySelector<HTMLButtonElement>('[data-testid="generate-from-review"] button')!.click();
      fixture.detectChanges();

      expect(compiled.textContent).toMatch(/no se pudo generar/i);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('no ofrece generar sobre un examen ya confirmado — ahí manda el CTA a las formas existentes', () => {
      const { compiled } = setup({ getExam: () => of({ ...EXAM, status: 'ready' }) });

      expect(compiled.querySelector('[data-testid="generate-from-review"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="go-to-versions"]')).toBeTruthy();
    });
  });

  /**
   * Audit 2026-08-15. Un ID de reemplazo inválido devuelve 400 CON mensaje y
   * la UI mostraba "No se pudo reemplazar la pregunta. Inténtalo de nuevo." —
   * un consejo falso, porque reintentar el mismo ID falla idéntico.
   */
  it('surfaces the server\'s own 400 message instead of the generic retry copy', () => {
    const { compiled, fixture } = setup({
      replaceQuestion: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: { statusCode: 400, message: 'Replacement question not found in this tenant' },
            }),
        ),
    });

    const manualInput = compiled.querySelector<HTMLInputElement>('[data-testid="manual-replacement-input"]')!;
    manualInput.value = 'no-soy-un-uuid';
    manualInput.dispatchEvent(new Event('input'));
    compiled.querySelector<HTMLButtonElement>('[data-testid="manual-replace-button"] button')!.click();
    fixture.detectChanges();

    expect(compiled.textContent).toContain('Replacement question not found in this tenant');
  });

  /**
   * Audit 2026-08-15: tras confirmar, el banner promete "ya puedes generar las
   * versiones" y la pantalla no tenía NI UN link ni botón para hacerlo — 0
   * links en toda la sección. Callejón sin salida.
   */
  it('offers a way to generate the versions once the exam is confirmed', () => {
    const { compiled, fixture, navigate } = setup({
      getExam: () => of({ ...EXAM, status: 'ready' }),
    });
    fixture.detectChanges();

    const cta = compiled.querySelector<HTMLButtonElement>('[data-testid="go-to-versions"] button');
    expect(cta).toBeTruthy();

    cta!.click();
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(['/app/exams', 'exam-1', 'versions']);
  });

  it('does not offer the versions CTA while the exam is still a draft', () => {
    const { compiled } = setup({});

    expect(compiled.querySelector('[data-testid="go-to-versions"]')).toBeFalsy();
  });

  /** El texto instruía a cambiar preguntas mientras cada botón estaba deshabilitado. */
  it('stops telling the teacher to swap questions once the exam is locked', () => {
    const { compiled } = setup({ getExam: () => of({ ...EXAM, status: 'ready' }) });

    expect(compiled.textContent).not.toMatch(/cámbialas si quieres/i);
  });

  /**
   * Audit 2026-08-15: la fila decía
   * "1 | 22131249-54e3-… | · | 7c389685-23d9-… | Media | Respuesta correcta: 4"
   * — ningún enunciado y dos UUIDs. Le pedíamos al docente que decidiera si
   * cambiar una pregunta que no podía leer.
   */
  describe('la pregunta se lee, no se adivina', () => {
    it('renders course and topic NAMES, never their uuids', () => {
      const { compiled } = setup({});

      const first = compiled.querySelector('[data-testid="exam-question"]')!;
      expect(first.textContent).toContain('Aritmética');
      expect(first.textContent).toContain('Teoría de conjuntos');
      expect(first.textContent).not.toContain('course-1');
      expect(first.textContent).not.toContain('topic-1');
    });

    it('renders the statement of a structured question', () => {
      const { compiled } = setup({ getExam: () => of(STRUCTURED_EXAM) });

      expect(compiled.querySelector('[data-testid="question-body"]')).toBeTruthy();
      expect(compiled.textContent).toContain('¿Cuántos elementos tiene');
    });

    it('shows the correct answer as a letter plus its text, not as a raw index', () => {
      const { compiled } = setup({ getExam: () => of(STRUCTURED_EXAM) });

      const answer = compiled.querySelector('[data-testid="correct-answer"]')!.textContent!;
      expect(answer).toContain('C');
      expect(answer).toContain('3');
      expect(answer).not.toMatch(/correcta:\s*2\b/);
    });

    it('keeps showing the stored letter for an image question (no alternatives to index into)', () => {
      const { compiled } = setup({});

      expect(compiled.querySelector('[data-testid="correct-answer"]')!.textContent).toContain('A');
    });
  });

  it('loads the exam by id from the route param and renders every selected question', () => {
    const { compiled, getExam } = setup({});

    expect(getExam).toHaveBeenCalledWith('exam-1');
    expect(compiled.querySelectorAll('[data-testid="exam-question"]').length).toBe(2);
    // Nombres, no ids — la pantalla dejó de pintar uuids (audit 2026-08-15).
    expect(compiled.textContent).toContain('Aritmética');
    expect(compiled.textContent).toContain('Álgebra');
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

    compiled.querySelector<HTMLButtonElement>('[data-testid="reroll-button"] button')!.click();
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
    compiled.querySelector<HTMLButtonElement>('[data-testid="manual-replace-button"] button')!.click();
    fixture.detectChanges();

    expect(replaceQuestion).toHaveBeenCalledWith('exam-1', 'q1', { mode: 'manual', replacementQuestionId: 'q9' });
  });

  it('shows an error message when replace fails', () => {
    const { compiled, fixture } = setup({
      replaceQuestion: () => throwError(() => new HttpErrorResponse({ status: 409, error: {} })),
    });

    compiled.querySelector<HTMLButtonElement>('[data-testid="reroll-button"] button')!.click();
    fixture.detectChanges();

    expect(compiled.textContent).toMatch(/no se pudo reemplazar/i);
  });

  it('confirms the exam and disables further replacement', () => {
    const { compiled, fixture, confirmExam } = setup({});

    compiled.querySelector<HTMLButtonElement>('[data-testid="confirm-button"] button')!.click();
    fixture.detectChanges();

    expect(confirmExam).toHaveBeenCalledWith('exam-1');
    expect(compiled.textContent).toMatch(/listo/i);
    expect(compiled.querySelector<HTMLButtonElement>('[data-testid="reroll-button"] button')!.disabled).toBe(true);
  });

  it('shows an error message when confirm fails', () => {
    const { compiled, fixture } = setup({
      confirmExam: () => throwError(() => new HttpErrorResponse({ status: 409, error: {} })),
    });

    compiled.querySelector<HTMLButtonElement>('[data-testid="confirm-button"] button')!.click();
    fixture.detectChanges();

    expect(compiled.textContent).toMatch(/no se pudo confirmar/i);
  });
});
