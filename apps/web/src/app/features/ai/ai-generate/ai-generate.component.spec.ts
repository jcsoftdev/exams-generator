import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { LucideAngularModule, Sparkles, TriangleAlert, Plus, Minus } from 'lucide-angular';
import { AiGenerateComponent } from './ai-generate.component';
import { AiService } from '../ai.service';
import { DraftCountService } from '../draft-count.service';
import { DraftQuestion, GenerateQuestionsResult, GenerateQuestionStreamEvent } from '../ai.models';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { Difficulty } from '@exams-generator/shared';

const COURSES: Course[] = [
  { id: 'c1', name: 'Biología' },
  { id: 'c2', name: 'Química' },
];
const TOPICS: Topic[] = [{ id: 't1', name: 'La célula', courseId: 'c1' }];

/** Every existing test drove `generateQuestions()` with a bare `GenerateQuestionsResult`; the streaming API instead resolves via a terminal `done` event carrying that same result — this wraps it so the rest of the suite reads the same as before. */
function doneEvent(result: GenerateQuestionsResult): GenerateQuestionStreamEvent {
  return { type: 'done', result };
}

function setup(
  over: {
    genImpl?: (...a: unknown[]) => unknown;
    listDraftsImpl?: (...a: unknown[]) => unknown;
    queryParams?: Record<string, string>;
  } = {},
) {
  const generateQuestionStream = vi.fn(
    over.genImpl ?? (() => of(doneEvent({ created: [{ id: 'a' }, { id: 'b' }], failed: [] }))),
  );
  const listDrafts = vi.fn(over.listDraftsImpl ?? (() => of([] as DraftQuestion[])));
  const getCourses = vi.fn(() => of(COURSES));
  const getTopics = vi.fn(() => of(TOPICS));
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    imports: [AiGenerateComponent, LucideAngularModule.pick({ Sparkles, TriangleAlert, Plus, Minus })],
    providers: [
      { provide: AiService, useValue: { generateQuestionStream, listDrafts } },
      { provide: TaxonomyService, useValue: { getCourses, getTopics } },
      { provide: Router, useValue: { navigate } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(over.queryParams ?? {}) } } },
    ],
  });
  const fixture = TestBed.createComponent(AiGenerateComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    generateQuestionStream,
    listDrafts,
    navigate,
    getCourses,
    getTopics,
  };
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
  it('shows the 1-2-3 empty state before generating', () => {
    const { compiled } = setup();
    expect(compiled.querySelector('[data-testid="batch-empty"]')).toBeTruthy();
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

  it('shows a live progress card while generating', () => {
    const subject = new Subject<GenerateQuestionStreamEvent>();
    const { compiled, fixture } = setup({ genImpl: () => subject.asObservable() });
    fillForm(fixture);
    set(fixture, 'count', 1); // one request so the single Subject drives the whole run
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="batch-progress"]')).toBeTruthy();
    subject.next(doneEvent({ created: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], failed: [] }));
    subject.complete();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="batch-progress"]')).toBeFalsy();
  });

  it('ticks the live character counter up as delta events arrive, and resets it on restart', () => {
    const subject = new Subject<GenerateQuestionStreamEvent>();
    const { compiled, fixture } = setup({ genImpl: () => subject.asObservable() });
    fillForm(fixture);
    set(fixture, 'count', 1);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="stream-live-indicator"]')?.textContent).toMatch(/conectando/i);

    subject.next({ type: 'delta', text: 'Hola' });
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="stream-live-indicator"]')?.textContent).toContain('4');

    subject.next({ type: 'delta', text: ' mundo' });
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="stream-live-indicator"]')?.textContent).toContain('10');

    subject.next({ type: 'restart' });
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="stream-live-indicator"]')?.textContent).toMatch(/conectando/i);

    subject.next(doneEvent({ created: [{ id: 'a' }], failed: [] }));
    subject.complete();
  });

  it('does NOT reset the form after generating', () => {
    const { compiled, fixture } = setup();
    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect((fixture.componentInstance as unknown as { courseId(): string }).courseId()).toBe('c1');
    expect((fixture.componentInstance as unknown as { count(): number }).count()).toBe(3);
  });

  it('shows partial-failure banner with a retry-failed action', () => {
    const { compiled, fixture, generateQuestionStream } = setup({
      genImpl: () =>
        of(doneEvent({ created: [{ id: 'a' }], failed: [{ index: 1, error: 'x' }, { index: 2, error: 'y' }] })),
    });
    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="batch-failures"]')).toBeTruthy();
    generateQuestionStream.mockClear();
    generateQuestionStream.mockReturnValue(of(doneEvent({ created: [{ id: 'z' }, { id: 'w' }], failed: [] })));
    (compiled.querySelector('[data-testid="retry-failed"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    // Sequential model: each request is a single question, one per failed item — count is no longer part of the payload at all.
    expect(generateQuestionStream).toHaveBeenCalledWith(
      expect.not.objectContaining({ count: expect.anything() }),
    );
  });

  it('shows only the warning banner (no status card) when ALL questions fail validation on a 200 response', () => {
    const { compiled, fixture } = setup({
      genImpl: () => of(doneEvent({ created: [], failed: [{ index: 0, error: 'x' }, { index: 1, error: 'y' }] })),
    });
    fillForm(fixture);
    set(fixture, 'count', 1);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelector('.text-2xl.font-extrabold.text-primary-900')).toBeFalsy();
    const banner = compiled.querySelector('[data-testid="batch-failures"]');
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toMatch(/ninguna pregunta pasó la validación/i);
    expect(compiled.querySelector('[data-testid="retry-failed"] button')?.textContent).toContain('Reintentar 2');
    expect(compiled.querySelector('[data-testid="batch-empty"]')).toBeTruthy();
  });

  it('navigates to the review queue from the footer', () => {
    const { compiled, fixture, navigate } = setup();
    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="go-review"] button') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/app/ai/review']);
  });

  it('renders readable question cards with stem, alternatives, and the correct answer marked (visual fidelity with the Taller mockup)', () => {
    const draft: DraftQuestion = {
      id: 'a',
      tenantId: null,
      courseId: 'c1',
      topicId: 't1',
      difficulty: Difficulty.Easy,
      gradeLevel: 'pre',
      correctAnswer: '1',
      bodyTypst: '¿Cuánto es 2+2?',
      alternatives: ['3', '4', '5'],
      figureCode: null,
    };
    const { compiled, fixture } = setup({
      genImpl: () => of(doneEvent({ created: [{ id: 'a' }], failed: [] })),
      listDraftsImpl: () => of([draft]),
    });
    fillForm(fixture);
    set(fixture, 'count', 1);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const card = compiled.querySelector('[data-testid="batch-question"]');
    expect(card?.textContent).toContain('¿Cuánto es 2+2?');
    expect(card?.textContent).toContain('Borrador IA');
    const correctAlt = card?.querySelector('[data-testid="alt-correct"]');
    expect(correctAlt?.textContent).toContain('4');
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

  it('retries with the ORIGINAL request params (snapshot), even if the form is edited afterward', () => {
    const { compiled, fixture, generateQuestionStream } = setup({
      genImpl: () => of(doneEvent({ created: [{ id: 'a' }], failed: [{ index: 1, error: 'x' }] })),
    });
    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    set(fixture, 'courseId', 'c2');

    generateQuestionStream.mockClear();
    generateQuestionStream.mockReturnValue(of(doneEvent({ created: [{ id: 'z' }], failed: [] })));
    (compiled.querySelector('[data-testid="retry-failed"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(generateQuestionStream).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'c1' }));
  });

  it('shows only the error banner (no status card, empty state intact) when the whole request fails', () => {
    const serverError = new HttpErrorResponse({ status: 500 });
    const { compiled, fixture } = setup({
      genImpl: () => throwError(() => serverError),
    });
    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.textContent).toMatch(/no se pudieron generar/i);
    expect(compiled.querySelector('[data-testid="batch-question"]')).toBeFalsy();
    expect(compiled.querySelector('.text-2xl.font-extrabold.text-primary-900')).toBeFalsy();
    expect(compiled.querySelector('[data-testid="batch-empty"]')).toBeTruthy();
  });

  it('syncs the sidebar draft-count badge (DraftCountService) after generating (F8 fix)', () => {
    const draftStub: DraftQuestion = {
      id: 'a',
      tenantId: null,
      courseId: 'c1',
      topicId: 't1',
      difficulty: Difficulty.Easy,
      gradeLevel: 'pre',
      correctAnswer: '1',
      bodyTypst: '¿Cuánto es 2+2?',
      alternatives: ['3', '4'],
      figureCode: null,
    };
    let call = 0;
    const { compiled, fixture } = setup({
      genImpl: () => of(doneEvent({ created: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], failed: [] })),
      listDraftsImpl: () => of(call++ === 0 ? [] : [draftStub, draftStub, draftStub]),
    });
    const draftCountService = TestBed.inject(DraftCountService);
    expect(draftCountService.count()).toBe(0);

    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(draftCountService.count()).toBe(3);
  });
});
