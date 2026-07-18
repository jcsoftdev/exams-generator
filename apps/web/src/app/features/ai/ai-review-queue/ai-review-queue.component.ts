import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { AiService } from '../ai.service';
import { DraftQuestion, EditDraftPayload } from '../ai.models';
import { extractErrorMessage } from '../extract-error-message';

/**
 * Draft review queue (design doc §5.2 steps 3-5): lists `status='draft'`
 * structured questions and lets a human edit/approve/reject each one. The
 * AI never publishes directly to the bank — this screen IS the human
 * curation gate.
 *
 * "Typst preview" note: there is no client-side Typst compiler. `PATCH
 * /bank/questions/:id` recompiles the preview server-side and responds 400
 * (never persists) if the markup is invalid after the edit — that 400 IS
 * the validation surfaced here (see `extract-error-message.ts`), not a
 * browser-rendered preview.
 */
@Component({
  selector: 'app-ai-review-queue',
  imports: [ReactiveFormsModule],
  templateUrl: './ai-review-queue.component.html',
})
export class AiReviewQueueComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly aiService = inject(AiService);

  protected readonly drafts = signal<DraftQuestion[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadErrorMessage = signal<string | null>(null);
  protected readonly savingIds = signal<ReadonlySet<string>>(new Set());
  protected readonly editErrors = signal<Readonly<Record<string, string>>>({});

  protected readonly formArray = this.formBuilder.array<FormGroup>([]);

  ngOnInit(): void {
    this.reload();
  }

  private reload(): void {
    this.loading.set(true);
    this.loadErrorMessage.set(null);

    this.aiService.listDrafts().subscribe({
      next: (drafts) => {
        this.loading.set(false);
        this.drafts.set(drafts);
        this.rebuildForm(drafts);
      },
      error: (_error: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadErrorMessage.set('No se pudieron cargar los borradores. Inténtalo de nuevo.');
      },
    });
  }

  private rebuildForm(drafts: readonly DraftQuestion[]): void {
    this.formArray.clear();
    for (const draft of drafts) {
      this.formArray.push(
        this.formBuilder.nonNullable.group({
          bodyTypst: [draft.bodyTypst ?? ''],
          alternatives: [(draft.alternatives ?? []).join('\n')],
          correctAnswer: [draft.correctAnswer],
          figureCode: [draft.figureCode ?? ''],
        }),
      );
    }
  }

  protected group(index: number): FormGroup {
    return this.formArray.at(index) as FormGroup;
  }

  protected isSaving(id: string): boolean {
    return this.savingIds().has(id);
  }

  protected errorFor(id: string): string | null {
    return this.editErrors()[id] ?? null;
  }

  protected onSave(draft: DraftQuestion, index: number): void {
    const raw = this.group(index).getRawValue() as {
      bodyTypst: string;
      alternatives: string;
      correctAnswer: string;
      figureCode: string;
    };

    const patch: EditDraftPayload = {
      bodyTypst: raw.bodyTypst,
      alternatives: raw.alternatives
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
      correctAnswer: raw.correctAnswer,
      figureCode: raw.figureCode || undefined,
    };

    this.clearError(draft.id);
    this.setSaving(draft.id, true);

    this.aiService.editDraft(draft.id, patch).subscribe({
      next: (updated) => {
        this.setSaving(draft.id, false);
        this.replaceDraft(updated);
      },
      error: (error: HttpErrorResponse) => {
        this.setSaving(draft.id, false);
        this.editErrors.update((errors) => ({ ...errors, [draft.id]: extractErrorMessage(error) }));
      },
    });
  }

  protected onApprove(draft: DraftQuestion): void {
    this.setSaving(draft.id, true);
    this.aiService.approveQuestion(draft.id).subscribe({
      next: () => {
        this.setSaving(draft.id, false);
        this.removeDraft(draft.id);
      },
      error: (error: HttpErrorResponse) => {
        this.setSaving(draft.id, false);
        this.editErrors.update((errors) => ({ ...errors, [draft.id]: extractErrorMessage(error) }));
      },
    });
  }

  protected onReject(draft: DraftQuestion): void {
    this.setSaving(draft.id, true);
    this.aiService.rejectQuestion(draft.id).subscribe({
      next: () => {
        this.setSaving(draft.id, false);
        this.removeDraft(draft.id);
      },
      error: (error: HttpErrorResponse) => {
        this.setSaving(draft.id, false);
        this.editErrors.update((errors) => ({ ...errors, [draft.id]: extractErrorMessage(error) }));
      },
    });
  }

  private replaceDraft(updated: DraftQuestion): void {
    const next = this.drafts().map((draft) => (draft.id === updated.id ? updated : draft));
    this.drafts.set(next);
    this.rebuildForm(next);
  }

  private removeDraft(id: string): void {
    const index = this.drafts().findIndex((draft) => draft.id === id);
    if (index === -1) {
      return;
    }
    this.drafts.set(this.drafts().filter((draft) => draft.id !== id));
    this.formArray.removeAt(index);
  }

  private setSaving(id: string, saving: boolean): void {
    this.savingIds.update((ids) => {
      const next = new Set(ids);
      if (saving) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  private clearError(id: string): void {
    this.editErrors.update((errors) => {
      const { [id]: _removed, ...rest } = errors;
      return rest;
    });
  }
}
