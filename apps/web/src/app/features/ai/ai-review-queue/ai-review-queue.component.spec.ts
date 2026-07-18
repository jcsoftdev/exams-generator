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
const DRAFTS = [draft({ id: 'd1' }), draft({ id: 'd2' })];

function setup(
  over: {
    listImpl?: () => unknown;
    previewImpl?: (id: string) => unknown;
    approveImpl?: () => unknown;
  } = {},
) {
  const listDrafts = vi.fn(over.listImpl ?? (() => of(DRAFTS)));
  const previewDraft = vi.fn(
    over.previewImpl ?? (() => of(new Blob(['%PDF'], { type: 'application/pdf' }))),
  );
  const approveQuestion = vi.fn(over.approveImpl ?? ((id: string) => of({ id })));
  const rejectQuestion = vi.fn((id: string) => of({ id }));
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:pdf-${n++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  TestBed.configureTestingModule({
    imports: [AiReviewQueueComponent],
    providers: [
      importProvidersFrom(LucideAngularModule.pick({ Check, Pencil, X, Sparkles })),
      { provide: AiService, useValue: { listDrafts, previewDraft, approveQuestion, rejectQuestion } },
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
});
