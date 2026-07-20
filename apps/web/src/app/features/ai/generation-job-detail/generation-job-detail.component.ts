import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '../../../ui/button/button.component';
import { ProgressComponent } from '../../../ui/progress/progress.component';
import { BannerComponent } from '../../../ui/banner/banner.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { AiService } from '../ai.service';
import { DraftCountService } from '../draft-count.service';
import { DraftQuestion, GenerationJob } from '../ai.models';

const ALTERNATIVE_LETTERS = ['a', 'b', 'c', 'd', 'e'];
const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES: readonly GenerationJob['status'][] = ['completed', 'failed', 'cancelled'];

/**
 * Live view of ONE generation job (design doc §6) — reachable directly by
 * URL, so refreshing or returning later always shows current server state.
 * Polls `AiService.getGenerationJob()` every 2s while pending/running;
 * question cards render via the same `listDrafts()`-diff-by-id technique
 * `AiGenerateComponent` used to use inline, now driven by the poll.
 */
@Component({
  selector: 'app-generation-job-detail',
  standalone: true,
  imports: [ButtonComponent, ProgressComponent, BannerComponent, TagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './generation-job-detail.component.html',
})
export class GenerationJobDetailComponent {
  private readonly aiService = inject(AiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly draftCountService = inject(DraftCountService);

  private readonly jobId = this.route.snapshot.paramMap.get('id')!;
  private readonly loadedQuestionIds = new Set<string>();
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  protected readonly job = signal<GenerationJob | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly cancelling = signal(false);
  protected readonly batchQuestions = signal<readonly DraftQuestion[]>([]);

  protected readonly isTerminal = computed(() => {
    const status = this.job()?.status;
    return status !== undefined && TERMINAL_STATUSES.includes(status);
  });

  constructor() {
    this.load();
    this.pollHandle = setInterval(() => this.load(), POLL_INTERVAL_MS);
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  private stopPolling(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private load(): void {
    this.aiService.getGenerationJob(this.jobId).subscribe({
      next: (job) => {
        this.job.set(job);
        this.loadError.set(null);
        if (TERMINAL_STATUSES.includes(job.status)) {
          this.stopPolling();
        }
        this.loadNewQuestions(job.createdQuestionIds);
      },
      error: () => this.loadError.set('No se pudo cargar el estado de la generación.'),
    });
  }

  private loadNewQuestions(ids: readonly string[]): void {
    const unseen = ids.filter((id) => !this.loadedQuestionIds.has(id));
    if (unseen.length === 0) return;

    this.aiService.listDrafts().subscribe((drafts) => {
      unseen.forEach((id) => this.loadedQuestionIds.add(id));
      const idSet = new Set(ids);
      const alreadyShown = new Set(this.batchQuestions().map((q) => q.id));
      const newlyLoaded = drafts.filter((d) => idSet.has(d.id) && !alreadyShown.has(d.id));
      this.batchQuestions.update((prev) => [...prev, ...newlyLoaded]);
      this.draftCountService.set(drafts.length);
    });
  }

  protected cancel(): void {
    if (this.cancelling()) return;
    this.cancelling.set(true);
    this.aiService.cancelGenerationJob(this.jobId).subscribe({
      next: (job) => {
        this.cancelling.set(false);
        this.job.set(job);
        if (TERMINAL_STATUSES.includes(job.status)) {
          this.stopPolling();
        }
      },
      error: () => this.cancelling.set(false),
    });
  }

  protected goToReview(): void {
    this.router.navigate(['/app/ai/review']);
  }

  protected goToHistory(): void {
    this.router.navigate(['/app/ai/jobs']);
  }

  protected letterAt(index: number): string {
    return ALTERNATIVE_LETTERS[index] ?? String(index);
  }
  protected letterFor(question: DraftQuestion): string {
    return this.letterAt(Number(question.correctAnswer));
  }
  protected isCorrect(question: DraftQuestion, alternativeIndex: number): boolean {
    return Number(question.correctAnswer) === alternativeIndex;
  }
}
