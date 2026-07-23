import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { LucideAngularModule, Check, Pencil, X, Sparkles, ChevronDown } from 'lucide-angular';
import { Difficulty } from '@exams-generator/shared';
import { AiReviewQueueComponent } from './ai-review-queue.component';
import { AiService } from '../ai.service';
import { DraftQuestion } from '../ai.models';
import { DraftCountService } from '../draft-count.service';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { BankService } from '../../bank/bank.service';

function draft(o: Partial<DraftQuestion> & { id: string }): DraftQuestion {
  return {
    id: o.id,
    tenantId: 't1',
    courseId: o.courseId ?? 'c1',
    topicId: o.topicId ?? 't1',
    difficulty: o.difficulty ?? Difficulty.Easy,
    gradeLevel: o.gradeLevel ?? 'pre',
    // Real shape per ai.models.ts: a 0-based INDEX string ("0"-"4"), not a
    // letter — the backend converts the AI's letter answer before storing.
    correctAnswer: o.correctAnswer ?? '0',
    bodyTypst: o.bodyTypst ?? '¿2+2?',
    alternatives: o.alternatives ?? ['4', '3'],
    figureCode: o.figureCode ?? null,
  };
}
const DRAFTS = [
  draft({
    id: 'd1',
    bodyTypst: '7. ¿Cuál organelo sintetiza proteínas?\na) Lisosoma b) Ribosoma',
    difficulty: Difficulty.Medium,
    gradeLevel: 'secundaria_3',
    courseId: 'c1',
    topicId: 't1',
  }),
  draft({ id: 'd2', courseId: 'c1', topicId: 't1' }),
];

const COURSES: Course[] = [{ id: 'c1', name: 'Biología' }];
const TOPICS_C1: Topic[] = [{ id: 't1', name: 'Célula', courseId: 'c1' }];

function setup(
  over: {
    listImpl?: () => unknown;
    previewImpl?: (id: string) => unknown;
    approveImpl?: () => unknown;
    getCoursesImpl?: () => unknown;
    getTopicsImpl?: (courseId: string) => unknown;
    updateQuestionImpl?: (id: string, patch: unknown) => unknown;
    reviseQuestionImpl?: (id: string, instruction: string) => unknown;
  } = {},
) {
  const listDrafts = vi.fn(over.listImpl ?? (() => of(DRAFTS)));
  const previewDraft = vi.fn(
    over.previewImpl ?? (() => of(new Blob(['%PDF'], { type: 'application/pdf' }))),
  );
  const approveQuestion = vi.fn(over.approveImpl ?? ((id: string) => of({ id })));
  const rejectQuestion = vi.fn((id: string) => of({ id }));
  const reviseQuestion = vi.fn(
    over.reviseQuestionImpl ??
      ((_id: string) =>
        of({ bodyTypst: 'revisado', alternatives: ['1', '2'], correctAnswer: '0', figureCode: null })),
  );
  const getCourses = vi.fn(over.getCoursesImpl ?? (() => of(COURSES)));
  const getTopics = vi.fn(over.getTopicsImpl ?? (() => of(TOPICS_C1)));
  const updateQuestion = vi.fn(
    over.updateQuestionImpl ?? ((id: string) => of({ id } as unknown)),
  );
  const draftCountSet = vi.fn();
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:pdf-${n++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  TestBed.configureTestingModule({
    imports: [AiReviewQueueComponent],
    providers: [
      importProvidersFrom(LucideAngularModule.pick({ Check, Pencil, X, Sparkles, ChevronDown })),
      {
        provide: AiService,
        useValue: { listDrafts, previewDraft, approveQuestion, rejectQuestion, reviseQuestion },
      },
      { provide: BankService, useValue: { updateQuestion } },
      { provide: TaxonomyService, useValue: { getCourses, getTopics } },
      { provide: DraftCountService, useValue: { set: draftCountSet } },
    ],
  });
  const fixture = TestBed.createComponent(AiReviewQueueComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    listDrafts,
    previewDraft,
    approveQuestion,
    rejectQuestion,
    reviseQuestion,
    getCourses,
    getTopics,
    updateQuestion,
    draftCountSet,
  };
}

describe('AiReviewQueueComponent', () => {
  it('lists drafts and auto-selects the first, compiling its preview', () => {
    const { compiled, previewDraft } = setup();
    expect(compiled.querySelectorAll('[data-testid="review-item"]').length).toBe(2);
    expect(previewDraft).toHaveBeenCalledWith('d1');
    expect(compiled.querySelector('[data-testid="preview-frame"]')?.getAttribute('src')).toMatch(
      /^blob:/,
    );
  });

  it('shows a skeleton while the preview compiles', () => {
    const subject = new Subject<Blob>();
    const { compiled, fixture } = setup({ previewImpl: () => subject.asObservable() });
    expect(compiled.querySelector('[data-testid="preview-loading"]')).toBeTruthy();
    subject.next(new Blob(['%PDF'], { type: 'application/pdf' }));
    subject.complete();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="preview-loading"]')).toBeFalsy();
  });

  it('falls back to formatted content when the preview render fails', () => {
    const { compiled } = setup({
      previewImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    });
    expect(compiled.querySelector('[data-testid="preview-fallback"]')).toBeTruthy();
  });

  it('approves the current draft and advances to the next', () => {
    const { compiled, fixture, approveQuestion, previewDraft } = setup();
    previewDraft.mockClear();
    (compiled.querySelector('[data-testid="approve"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(approveQuestion).toHaveBeenCalledWith('d1');
    expect(previewDraft).toHaveBeenCalledWith('d2'); // avanzó al siguiente
  });

  it('rejects with confirmation', () => {
    const { compiled, fixture, rejectQuestion } = setup();
    (compiled.querySelector('[data-testid="reject"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(rejectQuestion).not.toHaveBeenCalled();
    (compiled.querySelector('[data-testid="reject-confirm-yes"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(rejectQuestion).toHaveBeenCalledWith('d1');
  });

  it('shows the empty state when the queue is empty', () => {
    const { compiled } = setup({ listImpl: () => of([]) });
    expect(compiled.querySelector('[data-testid="empty-queue"]')).toBeTruthy();
  });

  it('resolves course/topic names via TaxonomyService instead of showing raw UUIDs', () => {
    const { compiled, getCourses, getTopics } = setup();
    expect(getCourses).toHaveBeenCalledTimes(1);
    expect(getTopics).toHaveBeenCalledWith('c1');

    const items = compiled.querySelectorAll('[data-testid="review-item"]');
    expect(items[0].textContent).toContain('Biología');
    expect(items[0].textContent).toContain('Célula');
    expect(items[0].textContent).not.toContain('c1');
    expect(items[0].textContent).not.toContain('t1 ');
  });

  it('exposes the full taxonomy as select options for the edit form (no extra HTTP call beyond the initial load)', () => {
    const { fixture, getCourses } = setup();
    const component = fixture.componentInstance as unknown as {
      courseOptions: () => { value: string; label: string }[];
      editTopicOptions: () => { value: string; label: string }[];
      editCourseId: { set: (v: string) => void };
    };

    expect(component.courseOptions()).toEqual([{ value: 'c1', label: 'Biología' }]);

    component.editCourseId.set('c1');
    expect(component.editTopicOptions()).toEqual([{ value: 't1', label: 'Célula' }]);

    expect(getCourses).toHaveBeenCalledTimes(1);
  });

  it('shows only the first line of the enunciado (truncated) per row', () => {
    const { compiled } = setup();
    const items = compiled.querySelectorAll('[data-testid="review-item"]');
    expect(items[0].textContent).toContain('¿Cuál organelo sintetiza proteínas?');
    expect(items[0].textContent).not.toContain('Lisosoma');
  });

  it('shows a difficulty chip per row', () => {
    const { compiled } = setup();
    const items = compiled.querySelectorAll('[data-testid="review-item"]');
    const tag = items[0].querySelector('[data-testid="tag"]');
    expect(tag?.textContent?.trim()).toBe('Media');
  });

  it('shows a difficulty chip and a human grade label in the panel header', () => {
    const { compiled } = setup();
    const header = compiled.querySelector('[data-testid="panel-header"]')!;
    expect(header.textContent).toContain('Media');
    expect(header.textContent).toContain('3° secundaria');
    expect(header.textContent).not.toContain('secundaria_3');
  });

  it('shows the correct-answer LETTER in the panel header, not the raw stored index', () => {
    // correctAnswer is stored as a 0-based index ("0"-"4") — the panel must
    // convert it to a letter (a-e) the same way ai-generate.component.ts
    // does, not render the raw digit.
    const { compiled } = setup({ listImpl: () => of([draft({ id: 'd1', correctAnswer: '1' })]) });
    const header = compiled.querySelector('[data-testid="panel-header"]')!;
    expect(header.textContent).toContain('clave: b');
    expect(header.textContent).not.toContain('clave: 1');
  });

  it('presents the preview as a styled "paper" with a bare, chromeless PDF viewer', () => {
    const { compiled } = setup();
    const paper = compiled.querySelector('[data-testid="paper-preview"]')!;
    expect(paper).toBeTruthy();
    expect(paper.className).toContain('bg-paper-bg');
    expect(paper.className).toContain('border-paper-border');

    const frameSrc = compiled.querySelector('[data-testid="preview-frame"]')?.getAttribute('src');
    expect(frameSrc).toMatch(/^blob:/);
    expect(frameSrc).toContain('#toolbar=0&navpanes=0&scrollbar=0');
  });

  it('pushes the initial draft count to DraftCountService after loading the queue', () => {
    const { draftCountSet } = setup();
    expect(draftCountSet).toHaveBeenCalledWith(2);
  });

  it('updates DraftCountService after approving a draft', () => {
    const { compiled, fixture, draftCountSet } = setup();
    draftCountSet.mockClear();
    (compiled.querySelector('[data-testid="approve"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(draftCountSet).toHaveBeenCalledWith(1);
  });

  it('updates DraftCountService after rejecting a draft', () => {
    const { compiled, fixture, draftCountSet } = setup();
    draftCountSet.mockClear();
    (compiled.querySelector('[data-testid="reject"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="reject-confirm-yes"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(draftCountSet).toHaveBeenCalledWith(1);
  });

  it('starts edit mode from the Editar button, seeding every field from the selected draft', () => {
    const { compiled, fixture } = setup();
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="panel-edit-form"]')).toBeTruthy();
    const enunciado = compiled.querySelector('[data-testid="edit-enunciado"]') as HTMLTextAreaElement;
    expect(enunciado.value).toBe('7. ¿Cuál organelo sintetiza proteínas?\na) Lisosoma b) Ribosoma');
    const alternatives = compiled.querySelector('[data-testid="edit-alternatives"]') as HTMLTextAreaElement;
    expect(alternatives.value).toBe('4\n3');
  });

  it('cancels edit mode without saving, restoring the read-only preview', () => {
    const { compiled, fixture } = setup();
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="edit-cancel"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="panel-edit-form"]')).toBeFalsy();
    expect(compiled.querySelector('[data-testid="paper-preview"]')).toBeTruthy();
  });

  it('filters the tema dropdown to the edit form\'s selected curso, with no extra HTTP call', () => {
    const { compiled, fixture, getTopics } = setup();
    getTopics.mockClear();
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      editTopicOptions: () => { value: string; label: string }[];
    };
    expect(component.editTopicOptions()).toEqual([{ value: 't1', label: 'Célula' }]);
    expect(getTopics).not.toHaveBeenCalled();
  });

  it('saves the edited draft via BankService.updateQuestion with the full payload including figureCode, then exits edit mode', () => {
    const { compiled, fixture, updateQuestion } = setup();
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const enunciado = compiled.querySelector('[data-testid="edit-enunciado"]') as HTMLTextAreaElement;
    enunciado.value = 'Enunciado corregido';
    enunciado.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(updateQuestion).toHaveBeenCalledWith('d1', {
      topicId: 't1',
      difficulty: Difficulty.Medium,
      gradeLevel: 'secundaria_3',
      correctAnswer: '0',
      bodyTypst: 'Enunciado corregido',
      alternatives: ['4', '3'],
      figureCode: '',
    });
    expect(compiled.querySelector('[data-testid="panel-edit-form"]')).toBeFalsy();
  });

  it('sends figureCode in the save payload when the draft has one', () => {
    const { compiled, fixture, updateQuestion } = setup({
      listImpl: () => of([draft({ id: 'd1', figureCode: '#circle((0,0))' })]),
    });
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(updateQuestion).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ figureCode: '#circle((0,0))' }),
    );
  });

  it('sends an empty figureCode ("" = explicit clear, per the PATCH contract) when the teacher blanks a previously-set figure', () => {
    const { compiled, fixture, updateQuestion } = setup({
      listImpl: () => of([draft({ id: 'd1', figureCode: '#circle((0,0))' })]),
    });
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const figureCode = compiled.querySelector('[data-testid="edit-figure-code"]') as HTMLTextAreaElement;
    expect(figureCode.value).toBe('#circle((0,0))');
    figureCode.value = '';
    figureCode.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    // "" (empty string), NOT undefined — sending undefined would tell the
    // backend "leave the current figureCode unchanged" (see
    // validate-update-structured-question.ts's doc comment), silently
    // keeping the bad figure the teacher just tried to remove.
    expect(updateQuestion).toHaveBeenCalledWith('d1', expect.objectContaining({ figureCode: '' }));
  });

  it('shows an error and stays in edit mode when saving fails', () => {
    const { compiled, fixture } = setup({
      updateQuestionImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    });
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="panel-edit-form"]')).toBeTruthy();
    const error = compiled.querySelector('[role="alert"]');
    expect(error?.textContent).toContain('No se pudo guardar');
  });

  it('surfaces the server-side Typst compile error instead of a generic message — the teacher needs to know WHAT failed in their markup', () => {
    const { compiled, fixture } = setup({
      updateQuestionImpl: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: {
                statusCode: 400,
                message: 'Typst compile failed: unexpected token',
                error: 'Bad Request',
              },
            }),
        ),
    });
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const error = compiled.querySelector('[data-testid="panel-edit-form"] [role="alert"]');
    expect(error?.textContent).toContain('Typst compile failed: unexpected token');
  });

  it('reloads the queue and refreshes the preview after a successful save', () => {
    const { compiled, fixture, listDrafts, previewDraft } = setup();
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    listDrafts.mockClear();
    previewDraft.mockClear();

    (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(listDrafts).toHaveBeenCalledTimes(1);
    expect(previewDraft).toHaveBeenCalledWith('d1');
    expect(previewDraft).toHaveBeenCalledTimes(1);
  });

  it('clears a stale approve/reject error banner after a successful save (reloadAfterSave bypasses select(), which used to clear it incidentally)', () => {
    const { compiled, fixture } = setup({
      approveImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    });
    (compiled.querySelector('[data-testid="approve"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.textContent).toContain('No se pudo aprobar');

    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.textContent).not.toContain('No se pudo aprobar');
  });

  it('keeps the edited draft selected after saving, even when it is not the first item in the queue', () => {
    const { compiled, fixture } = setup();
    const secondItem = compiled.querySelectorAll('[data-testid="review-item"]')[1] as HTMLButtonElement;
    secondItem.click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    // d2's panel (Fácil / Pre-admisión) must still be showing after save —
    // NOT reset to d1's (Media / 3° secundaria). Row list keeps both items
    // (a plain save, unlike approve/reject, never removes drafts from the
    // queue), so this must be scoped to panel-header, not the whole page.
    const header = compiled.querySelector('[data-testid="panel-header"]')!;
    expect(header.textContent).toContain('Pre-admisión');
    expect(header.textContent).not.toContain('3° secundaria');
  });

  it('revises the draft with AI, populating the edit form WITHOUT saving', () => {
    const { compiled, fixture, reviseQuestion, updateQuestion } = setup({
      reviseQuestionImpl: () =>
        of({
          bodyTypst: 'Enunciado revisado por IA',
          alternatives: ['10', '20', '30'],
          correctAnswer: '2',
          figureCode: '#import "@preview/cetz:0.5.2": canvas, draw',
        }),
    });
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const instructionInput = compiled.querySelector('[data-testid="ai-instruction"] input') as HTMLInputElement;
    instructionInput.value = 'hazla más difícil';
    instructionInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (compiled.querySelector('[data-testid="ai-revise"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(reviseQuestion).toHaveBeenCalledWith('d1', 'hazla más difícil');
    const enunciado = compiled.querySelector('[data-testid="edit-enunciado"]') as HTMLTextAreaElement;
    expect(enunciado.value).toBe('Enunciado revisado por IA');
    const alternatives = compiled.querySelector('[data-testid="edit-alternatives"]') as HTMLTextAreaElement;
    expect(alternatives.value).toBe('10\n20\n30');
    const figureCode = compiled.querySelector('[data-testid="edit-figure-code"]') as HTMLTextAreaElement;
    expect(figureCode.value).toBe('#import "@preview/cetz:0.5.2": canvas, draw');
    expect(updateQuestion).not.toHaveBeenCalled();
  });

  it('shows an error when AI revision fails, without touching the current form values', () => {
    const { compiled, fixture } = setup({
      reviseQuestionImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    });
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="ai-revise"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const error = compiled.querySelector('[data-testid="ai-error"]');
    expect(error?.textContent).toContain('No se pudo revisar');
    const enunciado = compiled.querySelector('[data-testid="edit-enunciado"]') as HTMLTextAreaElement;
    expect(enunciado.value).toBe('7. ¿Cuál organelo sintetiza proteínas?\na) Lisosoma b) Ribosoma');
  });
});
