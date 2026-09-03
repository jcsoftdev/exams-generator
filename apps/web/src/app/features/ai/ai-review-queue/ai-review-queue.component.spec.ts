import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { LucideAngularModule, Check, Pencil, X, Sparkles, ChevronDown } from 'lucide-angular';
import { Difficulty } from '@exams-generator/shared';
import { AiReviewQueueComponent, EDIT_STATE_KEY } from './ai-review-queue.component';
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

const COURSES: Course[] = [{ id: 'c1', name: 'Biología', stage: 'preuniversitario' }];
const TOPICS_C1: Topic[] = [{ id: 't1', name: 'Célula', courseId: 'c1', gradeLevel: null }];

function setup(
  over: {
    listImpl?: (page: number, pageSize: number) => unknown;
    previewImpl?: (id: string) => unknown;
    approveImpl?: () => unknown;
    rejectImpl?: () => unknown;
    getCoursesImpl?: () => unknown;
    getTopicsForCoursesImpl?: (courseIds: string[]) => unknown;
    updateQuestionImpl?: (id: string, patch: unknown) => unknown;
    reviseQuestionImpl?: (id: string, instruction: string) => unknown;
  } = {},
) {
  const listDraftsPaged = vi.fn(
    over.listImpl ?? (() => of({ items: DRAFTS, total: DRAFTS.length })),
  );
  const previewDraft = vi.fn(
    over.previewImpl ?? (() => of(new Blob(['%PDF'], { type: 'application/pdf' }))),
  );
  const approveQuestion = vi.fn(over.approveImpl ?? ((id: string) => of({ id })));
  const rejectQuestion = vi.fn(over.rejectImpl ?? ((id: string) => of({ id })));
  const reviseQuestion = vi.fn(
    over.reviseQuestionImpl ??
      ((_id: string) =>
        of({
          bodyTypst: 'revisado',
          alternatives: ['1', '2'],
          correctAnswer: '0',
          figureCode: null,
        })),
  );
  const getCourses = vi.fn(over.getCoursesImpl ?? (() => of(COURSES)));
  const getTopicsForCourses = vi.fn(over.getTopicsForCoursesImpl ?? (() => of(TOPICS_C1)));
  const updateQuestion = vi.fn(over.updateQuestionImpl ?? ((id: string) => of({ id } as unknown)));
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
        useValue: {
          listDraftsPaged,
          previewDraft,
          approveQuestion,
          rejectQuestion,
          reviseQuestion,
        },
      },
      { provide: BankService, useValue: { updateQuestion } },
      { provide: TaxonomyService, useValue: { getCourses, getTopicsForCourses } },
      { provide: DraftCountService, useValue: { set: draftCountSet } },
    ],
  });
  const fixture = TestBed.createComponent(AiReviewQueueComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    listDraftsPaged,
    previewDraft,
    approveQuestion,
    rejectQuestion,
    reviseQuestion,
    getCourses,
    getTopicsForCourses,
    updateQuestion,
    draftCountSet,
  };
}

describe('AiReviewQueueComponent', () => {
  // sessionStorage is a REAL browser global — jsdom does not reset it
  // between tests. The edit-persistence effect (finding #2, audit
  // 2026-08-18) now writes to it on every startEdit(), so a leftover
  // `EDIT_STATE_KEY` entry from one test (e.g. one that clicks "Editar" and
  // never cancels/saves) would otherwise "restore" onto the very next
  // test's freshly-mounted component whenever it also auto-selects draft
  // 'd1' — same reasoning as ExamBuilderComponent's spec clearing
  // `BUILDER_STATE_KEY` for the same underlying reason.
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

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
    let approved = false;
    const { compiled, fixture, approveQuestion, previewDraft } = setup({
      approveImpl: () => {
        approved = true;
        return of({ id: 'd1' });
      },
      // The real server no longer returns 'd1' once it's approved (it left
      // status=draft) — the reload after approve must reflect that, same as
      // it would against the real API.
      listImpl: () =>
        approved ? of({ items: [DRAFTS[1]], total: 1 }) : of({ items: DRAFTS, total: 2 }),
    });
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
    (
      compiled.querySelector('[data-testid="reject-confirm-yes"] button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(rejectQuestion).toHaveBeenCalledWith('d1');
  });

  it('shows the empty state when the queue is empty', () => {
    const { compiled } = setup({ listImpl: () => of({ items: [], total: 0 }) });
    expect(compiled.querySelector('[data-testid="empty-queue"]')).toBeTruthy();
  });

  it('resolves course/topic names via TaxonomyService instead of showing raw UUIDs', () => {
    const { compiled, getCourses, getTopicsForCourses } = setup();
    expect(getCourses).toHaveBeenCalledTimes(1);
    expect(getTopicsForCourses).toHaveBeenCalledTimes(1);
    expect(getTopicsForCourses).toHaveBeenCalledWith(['c1']);

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
    const { compiled } = setup({
      listImpl: () => of({ items: [draft({ id: 'd1', correctAnswer: '1' })], total: 1 }),
    });
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

  it("pushes the server TOTAL (not the current page's items.length) to DraftCountService — the whole point of paginating", () => {
    // A page can legitimately be smaller than the full queue; the badge must
    // never read `items.length` off a paginated response.
    const { draftCountSet } = setup({
      listImpl: () => of({ items: DRAFTS, total: 4231 }),
    });
    expect(draftCountSet).toHaveBeenCalledWith(4231);
    expect(draftCountSet).not.toHaveBeenCalledWith(2);
  });

  it('updates DraftCountService with the fresh server total after approving a draft', () => {
    let approved = false;
    const { compiled, fixture, draftCountSet } = setup({
      approveImpl: () => {
        approved = true;
        return of({ id: 'd1' });
      },
      listImpl: () =>
        approved ? of({ items: [DRAFTS[1]], total: 1 }) : of({ items: DRAFTS, total: 2 }),
    });
    draftCountSet.mockClear();
    (compiled.querySelector('[data-testid="approve"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(draftCountSet).toHaveBeenCalledWith(1);
  });

  it('updates DraftCountService with the fresh server total after rejecting a draft', () => {
    let rejected = false;
    const { compiled, fixture, draftCountSet } = setup({
      listImpl: () =>
        rejected ? of({ items: [DRAFTS[1]], total: 1 }) : of({ items: DRAFTS, total: 2 }),
    });
    draftCountSet.mockClear();
    (compiled.querySelector('[data-testid="reject"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    rejected = true;
    (
      compiled.querySelector('[data-testid="reject-confirm-yes"] button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(draftCountSet).toHaveBeenCalledWith(1);
  });

  describe('pagination', () => {
    it('requests page 1 at the component PAGE_SIZE on initial load', () => {
      const { fixture, listDraftsPaged } = setup();
      const component = fixture.componentInstance as unknown as { PAGE_SIZE: number };
      expect(listDraftsPaged).toHaveBeenCalledWith(1, component.PAGE_SIZE);
    });

    it('does not render pagination controls when everything fits on one page', () => {
      const { compiled } = setup();
      expect(compiled.querySelector('[data-testid="pagination-summary"]')).toBeFalsy();
    });

    it('renders pagination controls with the real total once the queue exceeds one page', () => {
      const { compiled, fixture } = setup({
        listImpl: () => of({ items: DRAFTS, total: 45 }),
      });
      const component = fixture.componentInstance as unknown as { PAGE_SIZE: number };
      expect(compiled.querySelector('[data-testid="pagination-summary"]')?.textContent).toContain(
        `${DRAFTS.length}`,
      );
      expect(compiled.querySelector('[data-testid="pagination-summary"]')?.textContent).toContain(
        '45',
      );
      expect(compiled.querySelector('[data-testid="pagination-current"]')?.textContent).toContain(
        `1 / ${Math.ceil(45 / component.PAGE_SIZE)}`,
      );
    });

    it('re-fetches the requested page when pagination-next is clicked', () => {
      const { compiled, fixture, listDraftsPaged } = setup({
        listImpl: () => of({ items: DRAFTS, total: 45 }),
      });
      listDraftsPaged.mockClear();
      const component = fixture.componentInstance as unknown as { PAGE_SIZE: number };
      (compiled.querySelector('[data-testid="pagination-next"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(listDraftsPaged).toHaveBeenCalledWith(2, component.PAGE_SIZE);
    });

    it('falls back to the previous page — instead of showing the "no hay borradores" empty state — when approving the last draft on a page empties it out but drafts remain on earlier pages', () => {
      let approvedOnPage2 = false;
      const { compiled, fixture, listDraftsPaged } = setup({
        listImpl: (page: number) => {
          if (page === 2 && !approvedOnPage2) {
            return of({ items: [draft({ id: 'd3' })], total: 21 });
          }
          if (page === 2 && approvedOnPage2) {
            // The lone draft on page 2 just got approved server-side — this
            // page is now genuinely empty, but the queue is NOT.
            return of({ items: [], total: 20 });
          }
          return of({ items: DRAFTS, total: 20 });
        },
        approveImpl: () => {
          approvedOnPage2 = true;
          return of({ id: 'd3' });
        },
      });
      const component = fixture.componentInstance as unknown as {
        onPageChange: (p: number) => void;
        PAGE_SIZE: number;
      };
      component.onPageChange(2);
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="review-item"]')?.textContent).toBeTruthy();

      listDraftsPaged.mockClear();
      (compiled.querySelector('[data-testid="approve"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      // Went back to page 1 automatically instead of rendering a false "empty" state.
      expect(listDraftsPaged).toHaveBeenNthCalledWith(1, 2, component.PAGE_SIZE);
      expect(listDraftsPaged).toHaveBeenNthCalledWith(2, 1, component.PAGE_SIZE);
      expect(compiled.querySelector('[data-testid="empty-queue"]')).toBeFalsy();
      expect(compiled.querySelectorAll('[data-testid="review-item"]').length).toBeGreaterThan(0);
    });
  });

  it('starts edit mode from the Editar button, seeding every field from the selected draft', () => {
    const { compiled, fixture } = setup();
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="panel-edit-form"]')).toBeTruthy();
    const enunciado = compiled.querySelector(
      '[data-testid="edit-enunciado"]',
    ) as HTMLTextAreaElement;
    expect(enunciado.value).toBe('7. ¿Cuál organelo sintetiza proteínas?\na) Lisosoma b) Ribosoma');
    const alternatives = compiled.querySelector(
      '[data-testid="edit-alternatives"]',
    ) as HTMLTextAreaElement;
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

  it("filters the tema dropdown to the edit form's selected curso, with no extra HTTP call", () => {
    const { compiled, fixture, getTopicsForCourses } = setup();
    getTopicsForCourses.mockClear();
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      editTopicOptions: () => { value: string; label: string }[];
    };
    expect(component.editTopicOptions()).toEqual([{ value: 't1', label: 'Célula' }]);
    expect(getTopicsForCourses).not.toHaveBeenCalled();
  });

  it('saves the edited draft via BankService.updateQuestion with the full payload including figureCode, then exits edit mode', () => {
    const { compiled, fixture, updateQuestion } = setup();
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const enunciado = compiled.querySelector(
      '[data-testid="edit-enunciado"]',
    ) as HTMLTextAreaElement;
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
      listImpl: () => of({ items: [draft({ id: 'd1', figureCode: '#circle((0,0))' })], total: 1 }),
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
      listImpl: () => of({ items: [draft({ id: 'd1', figureCode: '#circle((0,0))' })], total: 1 }),
    });
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const figureCode = compiled.querySelector(
      '[data-testid="edit-figure-code"]',
    ) as HTMLTextAreaElement;
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
    const { compiled, fixture, listDraftsPaged, previewDraft } = setup();
    (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    listDraftsPaged.mockClear();
    previewDraft.mockClear();

    (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(listDraftsPaged).toHaveBeenCalledTimes(1);
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
    const secondItem = compiled.querySelectorAll(
      '[data-testid="review-item"]',
    )[1] as HTMLButtonElement;
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

    const instructionInput = compiled.querySelector(
      '[data-testid="ai-instruction"] input',
    ) as HTMLInputElement;
    instructionInput.value = 'hazla más difícil';
    instructionInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (compiled.querySelector('[data-testid="ai-revise"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(reviseQuestion).toHaveBeenCalledWith('d1', 'hazla más difícil');
    const enunciado = compiled.querySelector(
      '[data-testid="edit-enunciado"]',
    ) as HTMLTextAreaElement;
    expect(enunciado.value).toBe('Enunciado revisado por IA');
    const alternatives = compiled.querySelector(
      '[data-testid="edit-alternatives"]',
    ) as HTMLTextAreaElement;
    expect(alternatives.value).toBe('10\n20\n30');
    const figureCode = compiled.querySelector(
      '[data-testid="edit-figure-code"]',
    ) as HTMLTextAreaElement;
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
    const enunciado = compiled.querySelector(
      '[data-testid="edit-enunciado"]',
    ) as HTMLTextAreaElement;
    expect(enunciado.value).toBe('7. ¿Cuál organelo sintetiza proteínas?\na) Lisosoma b) Ribosoma');
  });

  /**
   * Audit 2026-08-18 (cola de revisión IA), P1: `approve()`/`confirmReject()`
   * were the ONLY two mutating actions on this screen with no in-flight
   * guard — a double click sent two POSTs for the same draft. Same class of
   * bug already fixed for `ExamReviewComponent.replace()` (`replacing`
   * signal) — mirrored here with `approving`/`rejectSubmitting`.
   */
  describe('in-flight guards on approve/reject (audit P1)', () => {
    it('ignores a second click on Aprobar while the first request is still in flight', () => {
      const pending = new Subject<{ id: string }>();
      const { compiled, fixture, approveQuestion } = setup({ approveImpl: () => pending });

      const button = compiled.querySelector<HTMLButtonElement>('[data-testid="approve"] button')!;
      button.click();
      fixture.detectChanges();

      expect(button.disabled).toBe(true);
      button.click();
      fixture.detectChanges();

      expect(approveQuestion).toHaveBeenCalledTimes(1);
    });

    it('re-enables Aprobar once the request resolves', () => {
      const { compiled, fixture } = setup();
      const button = compiled.querySelector<HTMLButtonElement>('[data-testid="approve"] button')!;
      button.click();
      fixture.detectChanges();
      expect(button.disabled).toBe(false);
    });

    it('re-enables Aprobar after a failed request too — a row stuck disabled after an error is worse than the error', () => {
      const { compiled, fixture } = setup({
        approveImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });
      const button = compiled.querySelector<HTMLButtonElement>('[data-testid="approve"] button')!;
      button.click();
      fixture.detectChanges();
      expect(button.disabled).toBe(false);
      expect(compiled.textContent).toContain('No se pudo aprobar');
    });

    it('ignores a second click on the reject confirmation while the first request is still in flight', () => {
      const pending = new Subject<{ id: string }>();
      const { compiled, fixture, rejectQuestion } = setup({ rejectImpl: () => pending });

      (compiled.querySelector('[data-testid="reject"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      const confirmButton = compiled.querySelector<HTMLButtonElement>(
        '[data-testid="reject-confirm-yes"] button',
      )!;
      confirmButton.click();
      fixture.detectChanges();

      expect(confirmButton.disabled).toBe(true);
      confirmButton.click();
      fixture.detectChanges();

      expect(rejectQuestion).toHaveBeenCalledTimes(1);
    });

    it('re-enables the reject confirmation after a failed request', () => {
      const { compiled, fixture } = setup({
        rejectImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });
      (compiled.querySelector('[data-testid="reject"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      const confirmButton = compiled.querySelector<HTMLButtonElement>(
        '[data-testid="reject-confirm-yes"] button',
      )!;
      confirmButton.click();
      fixture.detectChanges();
      expect(confirmButton.disabled).toBe(false);
      expect(compiled.textContent).toContain('No se pudo rechazar');
    });
  });

  /**
   * Audit 2026-08-18 (cola de revisión IA), P1: the edit form lived only in
   * component signals — navigating away lost it silently, same bug already
   * fixed in `ExamBuilderComponent` via a versioned `sessionStorage` key and
   * a single `effect()`. Mirrored here, but keyed to the SPECIFIC draft being
   * edited (`EDIT_STATE_KEY`'s payload carries `draftId`) — restoring must
   * never splice a stale edit onto a different draft.
   */
  describe('unsaved edits survive navigation (audit P1, sessionStorage precedent from exam-builder)', () => {
    it('persists edits to sessionStorage keyed to the draft being edited', () => {
      const { compiled, fixture } = setup();
      (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const enunciado = compiled.querySelector(
        '[data-testid="edit-enunciado"]',
      ) as HTMLTextAreaElement;
      enunciado.value = 'Cambio sin guardar';
      enunciado.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const saved = JSON.parse(sessionStorage.getItem(EDIT_STATE_KEY)!);
      expect(saved.draftId).toBe('d1');
      expect(saved.body).toBe('Cambio sin guardar');
    });

    it('restores the unsaved edit — visibly announced — when the same draft is selected again after remounting the screen', () => {
      sessionStorage.setItem(
        EDIT_STATE_KEY,
        JSON.stringify({
          draftId: 'd1',
          courseId: 'c1',
          topicId: 't1',
          difficulty: Difficulty.Medium,
          gradeLevel: 'secundaria_3',
          correctAnswer: '0',
          body: 'Recuperado del sessionStorage',
          alternatives: '4\n3',
          figureCode: '',
          aiInstruction: '',
        }),
      );

      const { compiled } = setup();

      expect(compiled.querySelector('[data-testid="panel-edit-form"]')).toBeTruthy();
      const enunciado = compiled.querySelector(
        '[data-testid="edit-enunciado"]',
      ) as HTMLTextAreaElement;
      expect(enunciado.value).toBe('Recuperado del sessionStorage');
      // Must be visibly announced — the teacher can't otherwise tell this
      // apart from the server's current values.
      expect(compiled.querySelector('[data-testid="edit-restored-notice"]')).toBeTruthy();
    });

    it('does NOT splice a persisted edit onto the wrong draft — only restores once the MATCHING draft is actually selected', () => {
      sessionStorage.setItem(
        EDIT_STATE_KEY,
        JSON.stringify({
          draftId: 'd2',
          courseId: 'c1',
          topicId: 't1',
          difficulty: Difficulty.Easy,
          gradeLevel: 'pre',
          correctAnswer: '0',
          body: 'Edición pendiente de d2',
          alternatives: '4\n3',
          figureCode: '',
          aiInstruction: '',
        }),
      );

      const { compiled, fixture } = setup();
      // d1 auto-selects first — the persisted edit belongs to d2, so nothing
      // should be spliced onto d1's panel.
      expect(compiled.querySelector('[data-testid="panel-edit-form"]')).toBeFalsy();

      const secondItem = compiled.querySelectorAll(
        '[data-testid="review-item"]',
      )[1] as HTMLButtonElement;
      secondItem.click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="panel-edit-form"]')).toBeTruthy();
      const enunciado = compiled.querySelector(
        '[data-testid="edit-enunciado"]',
      ) as HTMLTextAreaElement;
      expect(enunciado.value).toBe('Edición pendiente de d2');
    });

    it('never restores a persisted edit whose draft id is no longer in the queue (approved/rejected elsewhere)', () => {
      sessionStorage.setItem(
        EDIT_STATE_KEY,
        JSON.stringify({
          draftId: 'gone-elsewhere',
          courseId: 'c1',
          topicId: 't1',
          difficulty: Difficulty.Easy,
          gradeLevel: 'pre',
          correctAnswer: '0',
          body: 'huérfano',
          alternatives: '4\n3',
          figureCode: '',
          aiInstruction: '',
        }),
      );
      const { compiled } = setup();
      expect(compiled.querySelector('[data-testid="panel-edit-form"]')).toBeFalsy();
      expect(compiled.textContent).not.toContain('huérfano');
    });

    it('clears the persisted edit once it is saved', () => {
      const { compiled, fixture } = setup();
      (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      const enunciado = compiled.querySelector(
        '[data-testid="edit-enunciado"]',
      ) as HTMLTextAreaElement;
      enunciado.value = 'Cambio sin guardar';
      enunciado.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(sessionStorage.getItem(EDIT_STATE_KEY)).not.toBeNull();

      (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(sessionStorage.getItem(EDIT_STATE_KEY)).toBeNull();
    });

    it('clears the persisted edit on cancel', () => {
      const { compiled, fixture } = setup();
      (compiled.querySelector('[data-testid="edit"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      const enunciado = compiled.querySelector(
        '[data-testid="edit-enunciado"]',
      ) as HTMLTextAreaElement;
      enunciado.value = 'Cambio sin guardar';
      enunciado.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(sessionStorage.getItem(EDIT_STATE_KEY)).not.toBeNull();

      (compiled.querySelector('[data-testid="edit-cancel"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(sessionStorage.getItem(EDIT_STATE_KEY)).toBeNull();
    });
  });

  /**
   * Audit 2026-08-18 (cola de revisión IA), P2: with the queue empty, the
   * left column's `ui-empty-state` AND the right panel's "La cola está
   * vacía." rendered at the same time — noise, not a lie. One survives.
   */
  it('shows only ONE empty state when the queue is empty — no duplicate message in the right panel', () => {
    const { compiled } = setup({ listImpl: () => of({ items: [], total: 0 }) });
    expect(compiled.querySelector('[data-testid="empty-queue"]')).toBeTruthy();
    expect(compiled.textContent).not.toContain('La cola está vacía');
  });
});
