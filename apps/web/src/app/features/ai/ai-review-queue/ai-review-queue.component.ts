import { Component, DestroyRef, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { forkJoin, map, of, switchMap } from 'rxjs';
import { LucideAngularModule } from 'lucide-angular';
import { Difficulty } from '@exams-generator/shared';
import { ButtonComponent } from '../../../ui/button/button.component';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { TagVariant } from '../../../ui/ui.types';
import { ModalComponent } from '../../../ui/modal/modal.component';
import { AiService } from '../ai.service';
import { DraftQuestion, GRADE_LEVEL_LABELS, GradeLevel } from '../ai.models';
import { DraftCountService } from '../draft-count.service';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';

/** Chrome-less PDF viewer fragment (S7 preview) — hides the native toolbar/thumbnails/scrollbar so it reads as a printed "paper", not a browser PDF viewer. */
const PREVIEW_FRAGMENT = '#toolbar=0&navpanes=0&scrollbar=0';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: 'Fácil',
  [Difficulty.Medium]: 'Media',
  [Difficulty.Hard]: 'Difícil',
};

/** Maps review-queue difficulty values to the design-system tag's semantic variants (same convention as bank-list). */
const DIFFICULTY_TAG_VARIANT: Record<Difficulty, TagVariant> = {
  [Difficulty.Easy]: 'easy',
  [Difficulty.Medium]: 'medium',
  [Difficulty.Hard]: 'hard',
};

/**
 * "Mesa de trabajo" review queue (design doc §5.2 steps 3-5, Task 10; audit
 * fixes for screens design doc §4 pantalla 4): two-column layout — a left
 * list of `status='draft'` structured questions and a right panel showing
 * the WYSIWYG PDF preview (S7 `GET /bank/questions/:id/preview`, embedded
 * via a `blob:` object URL, same authenticated-blob pattern as
 * `fetchQuestionImage`) styled as a printed "paper" (chrome-less viewer via
 * the `#toolbar=0&navpanes=0&scrollbar=0` fragment). The AI never publishes
 * directly to the bank — this screen IS the human curation gate.
 * Approve/Reject advance to the next draft automatically; Reject requires
 * confirmation via `ui-modal`.
 *
 * Course/topic names are resolved once via `TaxonomyService` (`getCourses`
 * + one `getTopics(courseId)` per course, same `forkJoin` fan-out pattern
 * as `BankListComponent`) so rows/header never show raw UUIDs.
 *
 * The pending-drafts count is pushed to `DraftCountService.set()` whenever
 * the queue loads or a draft is approved/rejected, keeping the shell
 * sidebar's "Cola de revisión · N" badge in sync without it polling itself.
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
  private readonly taxonomyService = inject(TaxonomyService);
  private readonly draftCountService = inject(DraftCountService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly drafts = signal<DraftQuestion[]>([]);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly courseNames = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly topicNames = signal<ReadonlyMap<string, string>>(new Map());

  protected readonly selected = signal<DraftQuestion | null>(null);
  protected readonly previewUrl = signal<SafeResourceUrl | null>(null);
  protected readonly previewLoading = signal(false);
  protected readonly previewFailed = signal(false);
  protected readonly rejecting = signal(false);
  protected readonly actionError = signal<string | null>(null);

  private readonly objectUrls: string[] = [];

  constructor() {
    this.loadTaxonomy();
    this.load();
    this.destroyRef.onDestroy(() => this.objectUrls.forEach((u) => URL.revokeObjectURL(u)));
  }

  /** Same id->name resolution pattern as `BankListComponent.fetchTaxonomy` — fetched independently of the drafts list so a slow taxonomy response never blocks the queue from rendering. */
  private loadTaxonomy(): void {
    this.taxonomyService
      .getCourses()
      .pipe(
        switchMap((courses) => {
          const topics$ = courses.length
            ? forkJoin(courses.map((course) => this.taxonomyService.getTopics(course.id)))
            : of([]);
          return topics$.pipe(
            map((topicsByCourse) => ({
              courseNames: new Map(courses.map((course) => [course.id, course.name])),
              topicNames: new Map(topicsByCourse.flat().map((topic) => [topic.id, topic.name])),
            })),
          );
        }),
      )
      .subscribe({
        next: ({ courseNames, topicNames }) => {
          this.courseNames.set(courseNames);
          this.topicNames.set(topicNames);
        },
        error: () => {
          /* rows fall back to raw ids — see courseTopicLabel() */
        },
      });
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.aiService.listDrafts().subscribe({
      next: (drafts) => {
        this.loading.set(false);
        this.drafts.set([...drafts]);
        this.draftCountService.set(drafts.length);
        if (drafts.length > 0) this.select(drafts[0]);
        else this.selected.set(null);
      },
      error: (_e: HttpErrorResponse) => {
        this.loading.set(false);
        this.errorMessage.set('No se pudo cargar la cola. Inténtalo de nuevo.');
      },
    });
  }

  /** First line of the Typst body, truncated by CSS in the row — falls back to '' for a missing/empty body. */
  protected firstLine(body: string | null): string {
    return (body ?? '').split('\n')[0] ?? '';
  }

  protected courseTopicLabel(draft: DraftQuestion): string {
    const course = this.courseNames().get(draft.courseId) ?? draft.courseId;
    const topic = this.topicNames().get(draft.topicId) ?? draft.topicId;
    return `${course} · ${topic}`;
  }

  protected difficultyLabel(difficulty: Difficulty): string {
    return DIFFICULTY_LABELS[difficulty];
  }

  protected tagVariantFor(difficulty: Difficulty): TagVariant {
    return DIFFICULTY_TAG_VARIANT[difficulty];
  }

  protected gradeLabel(gradeLevel: string): string {
    return GRADE_LEVEL_LABELS[gradeLevel as GradeLevel] ?? gradeLevel;
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
        this.previewUrl.set(
          this.sanitizer.bypassSecurityTrustResourceUrl(url + PREVIEW_FRAGMENT),
        );
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
    this.draftCountService.set(remaining.length);
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
