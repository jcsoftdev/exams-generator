import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { Difficulty } from '@exams-generator/shared';
import { AiReviewQueueComponent } from './ai-review-queue.component';
import { AiService } from '../ai.service';
import { DraftQuestion } from '../ai.models';

const DRAFTS: DraftQuestion[] = [
  {
    id: 'q1',
    tenantId: 'tenant-1',
    courseId: 'course-1',
    topicId: 'topic-1',
    difficulty: Difficulty.Medium,
    gradeLevel: 'secundaria_2',
    correctAnswer: 'b',
    bodyTypst: '$1 + 1 = 2$',
    alternatives: ['a', 'b', 'c', 'd', 'e'],
    figureCode: null,
  },
  {
    id: 'q2',
    tenantId: null,
    courseId: 'course-2',
    topicId: 'topic-2',
    difficulty: Difficulty.Hard,
    gradeLevel: 'primaria_5',
    correctAnswer: 'a',
    bodyTypst: 'other body',
    alternatives: ['a', 'b', 'c', 'd', 'e'],
    figureCode: '#cetz.canvas()',
  },
];

function setup(overrides: {
  listDraftsImpl?: (...args: unknown[]) => unknown;
  approveImpl?: (...args: unknown[]) => unknown;
  rejectImpl?: (...args: unknown[]) => unknown;
  editImpl?: (...args: unknown[]) => unknown;
}) {
  const listDrafts = vi.fn(overrides.listDraftsImpl ?? (() => of(DRAFTS)));
  const approveQuestion = vi.fn(overrides.approveImpl ?? ((id: string) => of({ id })));
  const rejectQuestion = vi.fn(overrides.rejectImpl ?? ((id: string) => of({ id })));
  const editDraft = vi.fn(overrides.editImpl ?? ((id: string) => of(DRAFTS.find((d) => d.id === id)!)));

  TestBed.configureTestingModule({
    imports: [AiReviewQueueComponent],
    providers: [
      { provide: AiService, useValue: { listDrafts, approveQuestion, rejectQuestion, editDraft } },
    ],
  });

  const fixture = TestBed.createComponent(AiReviewQueueComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  return { fixture, compiled, listDrafts, approveQuestion, rejectQuestion, editDraft };
}

describe('AiReviewQueueComponent', () => {
  it('loads and renders drafts with their bodyTypst, alternatives, correctAnswer and figureCode on init', () => {
    const { compiled, listDrafts } = setup({});

    expect(listDrafts).toHaveBeenCalled();
    const items = compiled.querySelectorAll('[data-testid="draft-item"]');
    expect(items.length).toBe(2);
    expect(compiled.textContent).toContain('$1 + 1 = 2$');
    expect(compiled.textContent).toContain('#cetz.canvas()');
  });

  it('surfaces a note that Typst compilation is server-side only, not previewed in the browser', () => {
    const { compiled } = setup({});

    expect(compiled.textContent).toMatch(/server/i);
    expect(compiled.textContent).toMatch(/typst/i);
  });

  it('approves a draft and removes it from the queue', () => {
    const { compiled, fixture, approveQuestion } = setup({});

    const approveButtons = compiled.querySelectorAll<HTMLButtonElement>(
      '[data-testid="approve-button"]',
    );
    approveButtons[0].click();
    fixture.detectChanges();

    expect(approveQuestion).toHaveBeenCalledWith('q1');
    expect(compiled.querySelectorAll('[data-testid="draft-item"]').length).toBe(1);
  });

  it('rejects a draft and removes it from the queue', () => {
    const { compiled, fixture, rejectQuestion } = setup({});

    const rejectButtons = compiled.querySelectorAll<HTMLButtonElement>(
      '[data-testid="reject-button"]',
    );
    rejectButtons[1].click();
    fixture.detectChanges();

    expect(rejectQuestion).toHaveBeenCalledWith('q2');
    expect(compiled.querySelectorAll('[data-testid="draft-item"]').length).toBe(1);
  });

  it('saves an edited draft with the updated bodyTypst, alternatives, correctAnswer and figureCode', () => {
    const { compiled, fixture, editDraft } = setup({});

    const items = compiled.querySelectorAll('[data-testid="draft-item"]');
    const firstItem = items[0] as HTMLElement;
    const bodyTextarea = firstItem.querySelector<HTMLTextAreaElement>(
      'textarea[name="bodyTypst"]',
    )!;
    bodyTextarea.value = 'edited body';
    bodyTextarea.dispatchEvent(new Event('input'));
    const answerInput = firstItem.querySelector<HTMLInputElement>(
      'input[name="correctAnswer"]',
    )!;
    answerInput.value = 'c';
    answerInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const saveButton = firstItem.querySelector<HTMLButtonElement>('[data-testid="save-button"]')!;
    saveButton.click();
    fixture.detectChanges();

    expect(editDraft).toHaveBeenCalledWith(
      'q1',
      expect.objectContaining({ bodyTypst: 'edited body', correctAnswer: 'c' }),
    );
  });

  it('shows the backend validation error next to the draft when saving an edit fails with 400', () => {
    const badRequest = new HttpErrorResponse({
      status: 400,
      error: { statusCode: 400, message: 'Typst compile failed: unexpected token' },
    });
    const { compiled, fixture } = setup({ editImpl: () => throwError(() => badRequest) });

    const items = compiled.querySelectorAll('[data-testid="draft-item"]');
    const firstItem = items[0] as HTMLElement;
    const saveButton = firstItem.querySelector<HTMLButtonElement>('[data-testid="save-button"]')!;
    saveButton.click();
    fixture.detectChanges();

    expect(firstItem.textContent).toMatch(/typst compile failed: unexpected token/i);
  });
});
