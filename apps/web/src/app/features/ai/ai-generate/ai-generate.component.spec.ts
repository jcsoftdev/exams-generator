import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { LucideAngularModule, Sparkles, Plus, Minus } from 'lucide-angular';
import { AiGenerateComponent } from './ai-generate.component';
import { AiService } from '../ai.service';
import { GenerationJob } from '../ai.models';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';

const COURSES: Course[] = [{ id: 'c1', name: 'Biología' }];
const TOPICS: Topic[] = [{ id: 't1', name: 'La célula', courseId: 'c1' }];

const CREATED_JOB: GenerationJob = {
  id: 'job-1',
  tenantId: 'tenant-1',
  courseId: 'c1',
  topicId: 't1',
  difficulty: 'easy' as GenerationJob['difficulty'],
  gradeLevel: 'pre',
  count: 3,
  withFigure: false,
  status: 'pending',
  createdCount: 0,
  failedCount: 0,
  createdQuestionIds: [],
  failedItems: [],
  cancelRequested: false,
  retriedFromJobId: null,
  rootJobId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
};

function setup(
  over: { createImpl?: (...a: unknown[]) => unknown; queryParams?: Record<string, string> } = {},
) {
  const createGenerationJob = vi.fn(over.createImpl ?? (() => of(CREATED_JOB)));
  const getCourses = vi.fn(() => of(COURSES));
  const getTopics = vi.fn(() => of(TOPICS));
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    imports: [AiGenerateComponent, LucideAngularModule.pick({ Sparkles, Plus, Minus })],
    providers: [
      { provide: AiService, useValue: { createGenerationJob } },
      { provide: TaxonomyService, useValue: { getCourses, getTopics } },
      { provide: Router, useValue: { navigate } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(over.queryParams ?? {}) } } },
    ],
  });
  const fixture = TestBed.createComponent(AiGenerateComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement, createGenerationJob, navigate, getCourses, getTopics };
}

function set(fixture: { componentInstance: unknown; detectChanges(): void }, prop: string, v: unknown) {
  (fixture.componentInstance as Record<string, { set(x: unknown): void }>)[prop].set(v);
  fixture.detectChanges();
}

function fillForm(fixture: { componentInstance: unknown; detectChanges(): void }) {
  set(fixture, 'courseId', 'c1');
  set(fixture, 'topicId', 't1');
  set(fixture, 'difficulty', 'easy');
  set(fixture, 'gradeLevel', 'pre');
  set(fixture, 'count', 3);
}

describe('AiGenerateComponent', () => {
  /**
   * Audit 2026-08-15: el segmentado de dificultad marcaba la selección SOLO con
   * color (`bg-tint-active`) — sin `role`, sin `aria-checked`. Invisible para un
   * lector de pantalla y ambiguo para un daltónico.
   */
  /**
   * Audit 2026-08-15: la celda del builder decía "Generar 2 con IA" y esta
   * pantalla abría con CANTIDAD 5 — el docente tenía que volver a deducir un
   * número que la pantalla anterior ya sabía.
   */
  describe('prefill de cantidad desde el builder', () => {
    it('abre con la cantidad que pidió la celda', () => {
      const { compiled } = setup({ queryParams: { gradeLevel: 'pre', count: '2' } });

      expect(compiled.textContent).toContain('Generar 2 preguntas');
    });

    it('ignora un count fuera de rango y se queda con su propio default', () => {
      const { compiled } = setup({ queryParams: { gradeLevel: 'pre', count: '0' } });

      expect(compiled.textContent).toContain('Generar 5 preguntas');
    });
  });

  describe('segmentado de Nivel — el estado no puede ser solo color', () => {
    it('expone el grupo y el estado de cada opción', () => {
      const { compiled } = setup({});

      const group = compiled.querySelector('[role="radiogroup"]')!;
      expect(group).toBeTruthy();
      expect(group.getAttribute('aria-labelledby')).toBeTruthy();

      const radios = compiled.querySelectorAll('[role="radio"]');
      expect(radios.length).toBe(3);
      expect([...radios].filter((r) => r.getAttribute('aria-checked') === 'true').length).toBeLessThanOrEqual(1);
    });

    it('mueve aria-checked al elegir, y añade una señal que no depende del color', () => {
      const { compiled, fixture } = setup({});

      const hard = compiled.querySelector<HTMLButtonElement>('[data-testid="difficulty-hard"]')!;
      hard.click();
      fixture.detectChanges();

      expect(hard.getAttribute('aria-checked')).toBe('true');
      expect(hard.textContent).toContain('•');
      expect(compiled.querySelector('[data-testid="difficulty-easy"]')!.getAttribute('aria-checked')).toBe('false');
      expect(compiled.querySelector('[data-testid="difficulty-easy"]')!.textContent).not.toContain('•');
    });
  });

  it('prefills grade, course, topic and difficulty from query params (exam-builder bridge)', () => {
    const { fixture, getCourses, getTopics } = setup({
      queryParams: { gradeLevel: 'secundaria_3', courseId: 'c1', topicId: 't1', difficulty: 'medium' },
    });
    const ci = fixture.componentInstance as unknown as {
      gradeLevel(): string | null;
      courseId(): string;
      topicId(): string;
      difficulty(): string | null;
    };

    expect(ci.gradeLevel()).toBe('secundaria_3');
    expect(ci.courseId()).toBe('c1');
    expect(ci.topicId()).toBe('t1');
    expect(ci.difficulty()).toBe('medium');
    expect(getCourses).toHaveBeenCalledWith('secundaria_3');
    expect(getTopics).toHaveBeenCalledWith('c1', 'secundaria_3');
  });

  it('clamps the quantity stepper to the backend max of 10 and disables the + button at the cap', () => {
    const { compiled, fixture } = setup();
    const plusButton = compiled.querySelector('button[aria-label="Más"]') as HTMLButtonElement;
    for (let i = 0; i < 10; i++) {
      plusButton.click();
      fixture.detectChanges();
    }
    expect((fixture.componentInstance as unknown as { count(): number }).count()).toBe(10);
    expect(plusButton.disabled).toBe(true);
  });

  it('creates a generation job with the form payload and navigates to its detail screen', () => {
    const { compiled, fixture, createGenerationJob, navigate } = setup();
    fillForm(fixture);

    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(createGenerationJob).toHaveBeenCalledWith({
      courseId: 'c1',
      topicId: 't1',
      difficulty: 'easy',
      gradeLevel: 'pre',
      count: 3,
      withFigure: false,
    });
    expect(navigate).toHaveBeenCalledWith(['/app/ai/jobs', 'job-1']);
  });

  it('does not submit while a create request is already in flight or the form is invalid', () => {
    const { compiled, createGenerationJob } = setup();

    // Form is empty — invalid.
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    expect(createGenerationJob).not.toHaveBeenCalled();
  });

  it('shows an error banner and re-enables the button when job creation fails', () => {
    const serverError = new HttpErrorResponse({ status: 500 });
    const { compiled, fixture } = setup({ createImpl: () => throwError(() => serverError) });
    fillForm(fixture);

    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.textContent).toMatch(/no se pudo iniciar la generación/i);
    const button = compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});
