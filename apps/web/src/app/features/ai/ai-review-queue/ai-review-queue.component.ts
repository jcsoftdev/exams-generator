import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { LucideAngularModule } from 'lucide-angular';
import { ButtonComponent } from '../../../ui/button/button.component';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { ModalComponent } from '../../../ui/modal/modal.component';
import { AiService } from '../ai.service';
import { DraftQuestion } from '../ai.models';

/**
 * "Mesa de trabajo" review queue (design doc §5.2 steps 3-5, Task 10):
 * two-column layout — a left list of `status='draft'` structured
 * questions and a right panel showing the WYSIWYG PDF preview (S7 `GET
 * /bank/questions/:id/preview`, embedded via a `blob:` object URL, same
 * authenticated-blob pattern as `fetchQuestionImage`). The AI never
 * publishes directly to the bank — this screen IS the human curation gate.
 * Approve/Reject advance to the next draft automatically; Reject requires
 * confirmation via `ui-modal`.
 *
 * "Editar" is wired but intentionally inert here — the full structured
 * editor (form + re-validation + preview-cache invalidation) is out of
 * scope for this task; see the note above the template's edit button.
 */
@Component({
  selector: 'app-ai-review-queue',
  standalone: true,
  imports: [ButtonComponent, EmptyStateComponent, TagComponent, ModalComponent, LucideAngularModule],
  templateUrl: './ai-review-queue.component.html',
})
export class AiReviewQueueComponent {
  private readonly aiService = inject(AiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly drafts = signal<DraftQuestion[]>([]);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly selected = signal<DraftQuestion | null>(null);
  protected readonly previewUrl = signal<SafeResourceUrl | null>(null);
  protected readonly previewLoading = signal(false);
  protected readonly previewFailed = signal(false);
  protected readonly rejecting = signal(false);
  protected readonly actionError = signal<string | null>(null);

  private readonly objectUrls: string[] = [];
  protected readonly firstLine = computed(() => {
    const body = this.selected()?.bodyTypst ?? '';
    return body.split('\n')[0] ?? '';
  });

  constructor() {
    this.load();
    this.destroyRef.onDestroy(() => this.objectUrls.forEach((u) => URL.revokeObjectURL(u)));
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.aiService.listDrafts().subscribe({
      next: (drafts) => {
        this.loading.set(false);
        this.drafts.set([...drafts]);
        if (drafts.length > 0) this.select(drafts[0]);
        else this.selected.set(null);
      },
      error: (_e: HttpErrorResponse) => {
        this.loading.set(false);
        this.errorMessage.set('No se pudo cargar la cola. Inténtalo de nuevo.');
      },
    });
  }

  protected select(draft: DraftQuestion): void {
    this.selected.set(draft);
    this.actionError.set(null);
    this.compilePreview(draft.id);
  }

  private compilePreview(id: string): void {
    this.previewUrl.set(null);
    this.previewFailed.set(false);
    this.previewLoading.set(true);
    this.aiService.previewDraft(id).subscribe({
      next: (blob) => {
        this.previewLoading.set(false);
        const url = URL.createObjectURL(blob);
        this.objectUrls.push(url);
        this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
      },
      error: () => {
        this.previewLoading.set(false);
        this.previewFailed.set(true);
      },
    });
  }

  private advanceAfter(id: string): void {
    const remaining = this.drafts().filter((d) => d.id !== id);
    this.drafts.set(remaining);
    if (remaining.length > 0) this.select(remaining[0]);
    else this.selected.set(null);
  }

  protected approve(): void {
    const current = this.selected();
    if (!current) return;
    this.actionError.set(null);
    this.aiService.approveQuestion(current.id).subscribe({
      next: () => this.advanceAfter(current.id),
      error: () => this.actionError.set('No se pudo aprobar. Inténtalo de nuevo.'),
    });
  }

  protected requestReject(): void {
    this.rejecting.set(true);
  }
  protected cancelReject(): void {
    this.rejecting.set(false);
  }
  protected confirmReject(): void {
    const current = this.selected();
    this.rejecting.set(false);
    if (!current) return;
    this.actionError.set(null);
    this.aiService.rejectQuestion(current.id).subscribe({
      next: () => this.advanceAfter(current.id),
      error: () => this.actionError.set('No se pudo rechazar. Inténtalo de nuevo.'),
    });
  }
}
