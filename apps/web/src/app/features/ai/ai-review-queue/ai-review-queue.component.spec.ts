import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { LucideAngularModule, Check, Pencil, X, Sparkles } from 'lucide-angular';
import { Difficulty } from '@exams-generator/shared';
import { AiReviewQueueComponent } from './ai-review-queue.component';
import { AiService } from '../ai.service';
import { DraftQuestion } from '../ai.models';
import { DraftCountService } from '../draft-count.service';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';

function draft(o: Partial<DraftQuestion> & { id: string }): DraftQuestion {
  return {
    id: o.id,
    tenantId: 't1',
    courseId: o.courseId ?? 'c1',
    topicId: o.topicId ?? 't1',
    difficulty: o.difficulty ?? Difficulty.Easy,
    gradeLevel: o.gradeLevel ?? 'pre',
    correctAnswer: o.correctAnswer ?? 'a',
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
  } = {},
) {
  const listDrafts = vi.fn(over.listImpl ?? (() => of(DRAFTS)));
  const previewDraft = vi.fn(
    over.previewImpl ?? (() => of(new Blob(['%PDF'], { type: 'application/pdf' }))),
  );
  const approveQuestion = vi.fn(over.approveImpl ?? ((id: string) => of({ id })));
  const rejectQuestion = vi.fn((id: string) => of({ id }));
  const getCourses = vi.fn(over.getCoursesImpl ?? (() => of(COURSES)));
  const getTopics = vi.fn(over.getTopicsImpl ?? (() => of(TOPICS_C1)));
  const draftCountSet = vi.fn();
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:pdf-${n++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  TestBed.configureTestingModule({
    imports: [AiReviewQueueComponent],
    providers: [
      importProvidersFrom(LucideAngularModule.pick({ Check, Pencil, X, Sparkles })),
      { provide: AiService, useValue: { listDrafts, previewDraft, approveQuestion, rejectQuestion } },
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
    getCourses,
    getTopics,
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
});
