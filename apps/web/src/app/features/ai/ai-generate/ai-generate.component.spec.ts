import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { LucideAngularModule, Sparkles, TriangleAlert, Plus, Minus } from 'lucide-angular';
import { AiGenerateComponent } from './ai-generate.component';
import { AiService } from '../ai.service';
import { DraftCountService } from '../draft-count.service';
import { DraftQuestion, GenerateQuestionsResult } from '../ai.models';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { Difficulty } from '@exams-generator/shared';

const COURSES: Course[] = [
  { id: 'c1', name: 'Biología' },
  { id: 'c2', name: 'Química' },
];
const TOPICS: Topic[] = [{ id: 't1', name: 'La célula', courseId: 'c1' }];

function setup(
  over: {
    genImpl?: (...a: unknown[]) => unknown;
    listDraftsImpl?: (...a: unknown[]) => unknown;
  } = {},
) {
  const generateQuestions = vi.fn(
    over.genImpl ??
      (() => of({ created: [{ id: 'a' }, { id: 'b' }], failed: [] } as GenerateQuestionsResult)),
  );
  const listDrafts = vi.fn(over.listDraftsImpl ?? (() => of([] as DraftQuestion[])));
  const getCourses = vi.fn(() => of(COURSES));
  const getTopics = vi.fn(() => of(TOPICS));
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    imports: [AiGenerateComponent, LucideAngularModule.pick({ Sparkles, TriangleAlert, Plus, Minus })],
    providers: [
      { provide: AiService, useValue: { generateQuestions, listDrafts } },
      { provide: TaxonomyService, useValue: { getCourses, getTopics } },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const fixture = TestBed.createComponent(AiGenerateComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    generateQuestions,
    listDrafts,
    navigate,
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

  it('shows a live progress card while generating', () => {
    const subject = new Subject<GenerateQuestionsResult>();
    const { compiled, fixture } = setup({ genImpl: () => subject.asObservable() });
    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="batch-progress"]')).toBeTruthy();
    subject.next({ created: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], failed: [] });
    subject.complete();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="batch-progress"]')).toBeFalsy();
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
    const { compiled, fixture, generateQuestions } = setup({
      genImpl: () => of({ created: [{ id: 'a' }], failed: [{ index: 1, error: 'x' }, { index: 2, error: 'y' }] }),
    });
    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="batch-failures"]')).toBeTruthy();
    generateQuestions.mockClear();
    generateQuestions.mockReturnValue(of({ created: [{ id: 'z' }, { id: 'w' }], failed: [] }));
    (compiled.querySelector('[data-testid="retry-failed"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(generateQuestions).toHaveBeenCalledWith(expect.objectContaining({ count: 2 }));
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
      genImpl: () => of({ created: [{ id: 'a' }], failed: [] }),
      listDraftsImpl: () => of([draft]),
    });
    fillForm(fixture);
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
    const { compiled, fixture, generateQuestions } = setup({
      genImpl: () => of({ created: [{ id: 'a' }], failed: [{ index: 1, error: 'x' }] }),
    });
    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    // User edits the form AFTER generating but BEFORE retrying.
    set(fixture, 'courseId', 'c2');

    generateQuestions.mockClear();
    generateQuestions.mockReturnValue(of({ created: [{ id: 'z' }], failed: [] }));
    (compiled.querySelector('[data-testid="retry-failed"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(generateQuestions).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'c1', count: 1 }));
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
    // First listDrafts() call is DraftCountService's own initial fetch (on
    // construction, BEFORE anything is generated) — must return a DIFFERENT
    // count than the post-generate call so this test actually exercises the
    // sync, not just the constructor's own baseline fetch.
    let call = 0;
    const { compiled, fixture } = setup({
      genImpl: () => of({ created: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], failed: [] }),
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
