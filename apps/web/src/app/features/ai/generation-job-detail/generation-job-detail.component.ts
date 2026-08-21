import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { DatePipe } from '@angular/common';
import { Subscription, TimeoutError, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ButtonComponent } from '../../../ui/button/button.component';
import { ProgressComponent } from '../../../ui/progress/progress.component';
import { BannerComponent } from '../../../ui/banner/banner.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { MathTextComponent } from '../../../ui/math-text/math-text.component';
import { TagVariant } from '../../../ui/ui.types';
import { AiService } from '../ai.service';
import { DraftCountService } from '../draft-count.service';
import { DraftQuestion, GenerationJob } from '../ai.models';
import { toPdfPreviewUrl } from '../pdf-preview-url';

const ALTERNATIVE_LETTERS = ['a', 'b', 'c', 'd', 'e'];
const TERMINAL_STATUSES: readonly GenerationJob['status'][] = ['completed', 'failed', 'cancelled'];

/** Same status → tag/label mapping as `GenerationHistoryComponent` — duplicated locally rather than exported/shared, matching this feature's existing convention of small local copies over cross-component coupling. */
const STATUS_TAG: Record<GenerationJob['status'], TagVariant> = {
  pending: 'ai',
  running: 'ai',
  completed: 'easy',
  failed: 'hard',
  cancelled: 'medium',
};

const STATUS_LABEL: Record<GenerationJob['status'], string> = {
  pending: 'En cola',
  running: 'Generando',
  completed: 'Completado',
  failed: 'Falló',
  cancelled: 'Cancelado',
};

/**
 * Screen-reader progress announcements (audit P2 — a11y): a batch job can run
 * for a while with nothing pushed to assistive tech except silent DOM
 * updates. Announcing every SSE frame would turn the live region into a
 * machine gun (createdCount can tick once per question), so this only fires
 * on genuine milestones: the very first frame (start OR an already-terminal
 * reload), a quarter of the batch completing, and the terminal state. See
 * `updateAnnouncement()`.
 */
const PROGRESS_QUARTILES = 4;

/**
 * Live view of ONE generation job (design doc §6) — reachable directly by
 * URL, so refreshing or returning later always shows current server state.
 * Subscribes to `AiService.streamGenerationJob()` — a server-pushed SSE
 * stream, not a client interval — so job progress arrives the moment the
 * backend writes it, with no polling anywhere in the request path. Question
 * cards render via a direct-by-id diff, driven by each pushed frame: for
 * every id in `job.createdQuestionIds` not already shown, one
 * `AiService.getDraft(id)` (`GET /bank/questions/:id`) — NOT
 * `listDrafts()`'s flat unpaginated array, which this screen used to
 * download in full just to pick a handful of ids out of it
 * (docs/audit-2026-08-14.md, "`GET /bank/questions` sin `page` sigue sin
 * tope"). The sidebar draft-count badge is kept in sync via
 * `DraftCountService.refresh()` (a real `countDrafts()` round-trip) instead
 * of a locally-derived length, since this screen no longer has the whole
 * queue in hand to count.
 *
 * `jobId` is read REACTIVELY from `route.paramMap` (never `route.snapshot`)
 * because `retry()` navigates to this exact same route with a different
 * `:id` — Angular's default `RouteReuseStrategy` reuses the component
 * instance for same-route-config navigations (no re-construction), so a
 * snapshot-captured id would go stale the moment a retry lands. The
 * constructor's `effect()` re-subscribes to the stream (and resets every
 * per-job signal) whenever `jobId` changes, covering both a real external
 * navigation AND an in-place retry the same way.
 */
@Component({
  selector: 'app-generation-job-detail',
  standalone: true,
  imports: [ButtonComponent, ProgressComponent, BannerComponent, TagComponent, MathTextComponent, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './generation-job-detail.component.html',
})
export class GenerationJobDetailComponent {
  private readonly aiService = inject(AiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly draftCountService = inject(DraftCountService);
  private readonly sanitizer = inject(DomSanitizer);

  private readonly paramMap = toSignal(this.route.paramMap, { requireSync: true });
  protected readonly jobId = computed(() => this.paramMap().get('id')!);

  private readonly loadedQuestionIds = new Set<string>();
  private readonly objectUrls: string[] = [];

  protected readonly job = signal<GenerationJob | null>(null);
  protected readonly loadError = signal<string | null>(null);
  /**
   * Set when the stream's watchdog fires (audit P0 — `AiService`'s
   * `AI_STREAM_WATCHDOG_MS`), DELIBERATELY separate from `loadError`: the
   * worker on the other side may still be generating fine, only the SSE
   * connection went silent. Never implies the job failed, and never clears
   * `job`/`batchQuestions` — see `attachStream()`/`checkJobStatus()`.
   */
  protected readonly connectionLost = signal(false);
  /** Bumped by `reload()` to re-trigger the load effect below without a route change — the effect reads this alongside `jobId` so it's a tracked dependency. */
  private readonly reloadNonce = signal(0);
  protected readonly cancelling = signal(false);
  protected readonly retrying = signal(false);
  protected readonly batchQuestions = signal<readonly DraftQuestion[]>([]);
  protected readonly previewUrls = signal<ReadonlyMap<string, SafeResourceUrl>>(new Map());
  protected readonly previewFailedIds = signal<ReadonlySet<string>>(new Set());
  protected readonly chain = signal<readonly GenerationJob[]>([]);
  protected readonly progressAnnouncement = signal('');
  private hasAnnouncedStart = false;
  private lastAnnouncedMilestone = 0;

  protected readonly isTerminal = computed(() => {
    const status = this.job()?.status;
    return status !== undefined && TERMINAL_STATUSES.includes(status);
  });
  /**
   * How many items are genuinely worth resubmitting: whatever never ended up
   * a persisted draft, whether it failed compile/generation or was never
   * attempted at all (crashed-`failed`/`cancelled` mid-batch). This single
   * `count - createdCount` formula is correct for every terminal status —
   * for a `completed` job every item was attempted, so it collapses to
   * exactly `failedCount`; for a `failed`/`cancelled` job it also covers
   * the items that were never reached, which a `failedCount`-only retry
   * would silently drop.
   */
  protected readonly retryCount = computed(() => {
    const j = this.job();
    return j ? Math.max(0, j.count - j.createdCount) : 0;
  });
  protected readonly canRetry = computed(() => this.isTerminal() && this.retryCount() > 0);
  /** Every attempt in this job's chain EXCEPT the one currently on screen — the "historial de reintentos" list. Empty for a job that was never part of a retry. */
  protected readonly previousAttempts = computed(() => this.chain().filter((attempt) => attempt.id !== this.jobId()));

  private streamSubscription: Subscription | null = null;

  constructor() {
    effect((onCleanup) => {
      const id = this.jobId();
      this.reloadNonce();
      // Everything below reads AND writes signals (batchQuestions,
      // previewUrls, job...) as part of loading a job — if any of those
      // reads happened while tracked, Angular would register the signal as
      // an effect dependency, and the later write to that same signal
      // (still inside this same synchronous run, since these mocks/HTTP
      // responses can resolve synchronously in tests) would re-trigger this
      // effect. `resetForNewJob()` unconditionally clears state on every
      // run, so that re-trigger would never converge — an infinite loop.
      // `untracked()` keeps `jobId` as the ONLY reactive dependency.
      untracked(() => {
        this.resetForNewJob();
        this.attachStream(id);
        onCleanup(() => this.streamSubscription?.unsubscribe());
        // One-shot, unlike the stream above: past attempts are already
        // terminal and never change, so there's nothing to keep pushing.
        this.aiService.getGenerationJobChain(id).subscribe((res) => this.chain.set(res.items));
      });
    });
    this.destroyRef.onDestroy(() => this.revokeObjectUrls());
  }

  /**
   * (Re-)subscribes to `streamGenerationJob(id)`. Split out of the
   * constructor's effect so `reconnect()` can call it WITHOUT going through
   * `resetForNewJob()` — a watchdog firing must never throw away progress
   * already on screen.
   */
  private attachStream(id: string): void {
    this.streamSubscription?.unsubscribe();
    this.streamSubscription = this.aiService.streamGenerationJob(id).subscribe({
      next: (job) => {
        this.job.set(job);
        this.loadError.set(null);
        this.connectionLost.set(false);
        this.loadNewQuestions(job.createdQuestionIds);
        this.updateAnnouncement(job);
      },
      error: (err: unknown) => {
        if (err instanceof TimeoutError) {
          // The CONNECTION went silent — not the same claim as "the job
          // failed" (audit P0). Whatever job/question state is already
          // rendered stays exactly as it is; settle "is it still running?"
          // with one cheap GET instead of guessing.
          this.connectionLost.set(true);
          this.checkJobStatus(id);
        } else {
          this.loadError.set('No se pudo cargar el estado de la generación.');
        }
      },
    });
  }

  /**
   * The watchdog's recovery step: a single `GET /ai/questions/jobs/:id`
   * (already used elsewhere, e.g. retry navigation) — cheaper than
   * re-opening the stream and answers "is it still running?" immediately.
   * A terminal result closes out `connectionLost` exactly like a normal
   * terminal frame would; a non-terminal result keeps the banner up so the
   * teacher can choose to `reconnect()` for live updates again.
   */
  private checkJobStatus(id: string): void {
    this.aiService.getGenerationJob(id).subscribe({
      next: (job) => {
        this.job.set(job);
        this.loadNewQuestions(job.createdQuestionIds);
        this.updateAnnouncement(job);
        if (TERMINAL_STATUSES.includes(job.status)) {
          this.connectionLost.set(false);
        }
      },
      // The settling GET failed too (e.g. genuinely offline) — stay in the
      // connection-lost state; `reconnect()` remains available.
      error: () => undefined,
    });
  }

  /** "Reconectar" — re-opens the live stream without resetting any state already on screen. */
  protected reconnect(): void {
    this.connectionLost.set(false);
    this.attachStream(this.jobId());
  }

  protected reload(): void {
    this.reloadNonce.update((n) => n + 1);
  }

  private resetForNewJob(): void {
    this.job.set(null);
    this.loadError.set(null);
    this.connectionLost.set(false);
    this.batchQuestions.set([]);
    this.previewUrls.set(new Map());
    this.previewFailedIds.set(new Set());
    this.chain.set([]);
    this.loadedQuestionIds.clear();
    this.revokeObjectUrls();
    this.progressAnnouncement.set('');
    this.hasAnnouncedStart = false;
    this.lastAnnouncedMilestone = 0;
  }

  /**
   * Fires the sr-only live-region text for exactly the milestones worth
   * interrupting a screen reader for — see the `PROGRESS_QUARTILES` comment
   * above. A terminal status always wins, even on the first frame (a page
   * reload of an already-finished job must not say "Generando…").
   */
  private updateAnnouncement(job: GenerationJob): void {
    if (TERMINAL_STATUSES.includes(job.status)) {
      if (job.status === 'completed') {
        this.progressAnnouncement.set(`Generación completada: ${job.createdCount} de ${job.count} preguntas creadas.`);
      } else if (job.status === 'failed') {
        this.progressAnnouncement.set('La generación falló.');
      } else {
        this.progressAnnouncement.set('Generación cancelada.');
      }
      return;
    }

    const done = job.createdCount + job.failedCount;
    const milestone = job.count > 0 ? Math.floor((done / job.count) * PROGRESS_QUARTILES) : 0;

    if (!this.hasAnnouncedStart) {
      this.hasAnnouncedStart = true;
      // Whatever quartile the job already sits at on this first frame counts
      // as "covered" — a reload mid-batch shouldn't immediately re-announce
      // the same progress the start message just implied.
      this.lastAnnouncedMilestone = milestone;
      this.progressAnnouncement.set(`Generando ${job.count} preguntas…`);
      return;
    }

    if (milestone > this.lastAnnouncedMilestone) {
      this.lastAnnouncedMilestone = milestone;
      this.progressAnnouncement.set(`${done} de ${job.count} preguntas completadas.`);
    }
  }

  private revokeObjectUrls(): void {
    this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.objectUrls.length = 0;
  }

  private loadNewQuestions(ids: readonly string[]): void {
    const unseen = ids.filter((id) => !this.loadedQuestionIds.has(id));
    if (unseen.length === 0) return;
    // Marked seen synchronously — BEFORE the async getDraft() calls below
    // resolve — so two stream frames arriving close together can never see
    // the same id as "unseen" twice and fire a duplicate fetch/preview
    // compile for it.
    unseen.forEach((id) => this.loadedQuestionIds.add(id));

    // One direct-by-id fetch per unseen id (not the whole queue) — a failed
    // fetch for one id (e.g. a race with a reject) resolves to `null` rather
    // than failing the whole batch via forkJoin.
    forkJoin(
      unseen.map((id) => this.aiService.getDraft(id).pipe(catchError(() => of(null)))),
    ).subscribe((results) => {
      const newlyLoaded = results.filter((q): q is DraftQuestion => q !== null);
      this.batchQuestions.update((prev) => [...prev, ...newlyLoaded]);
      // No flat array in hand to derive a count from anymore — ask the
      // server for the real total instead (same `countDrafts()` round-trip
      // DraftCountService already exposes for exactly this).
      this.draftCountService.refresh();
      newlyLoaded.forEach((q) => this.compilePreview(q.id));
    });
  }

  /** Real, compiled Typst → PDF preview per card — same `previewDraft()` blob-URL idiom as `AiReviewQueueComponent`, one per question instead of one shared slot. */
  private compilePreview(id: string): void {
    this.aiService.previewDraft(id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        this.objectUrls.push(url);
        const safeUrl = toPdfPreviewUrl(this.sanitizer, url);
        this.previewUrls.update((prev) => new Map(prev).set(id, safeUrl));
      },
      error: () => {
        this.previewFailedIds.update((prev) => new Set(prev).add(id));
      },
    });
  }

  protected cancel(): void {
    if (this.cancelling()) return;
    this.cancelling.set(true);
    this.aiService.cancelGenerationJob(this.jobId()).subscribe({
      next: (job) => {
        this.cancelling.set(false);
        this.job.set(job);
      },
      error: () => this.cancelling.set(false),
    });
  }

  /** Resubmits a fresh job for exactly `retryCount()` items and navigates to its detail screen — the `effect()` above picks up the id change and reloads from a clean state. */
  protected retry(): void {
    const j = this.job();
    if (!j || this.retrying() || this.retryCount() === 0) return;
    this.retrying.set(true);
    this.aiService
      .createGenerationJob({
        courseId: j.courseId,
        topicId: j.topicId,
        difficulty: j.difficulty,
        gradeLevel: j.gradeLevel,
        count: this.retryCount(),
        withFigure: j.withFigure,
        retriedFromJobId: j.id,
      })
      .subscribe({
        next: (newJob) => {
          this.retrying.set(false);
          this.router.navigate(['/app/ai/jobs', newJob.id]);
        },
        error: () => {
          this.retrying.set(false);
          this.loadError.set('No se pudo reintentar la generación.');
        },
      });
  }

  protected goToReview(): void {
    this.router.navigate(['/app/ai/review']);
  }

  protected goToHistory(): void {
    this.router.navigate(['/app/ai/jobs']);
  }

  /** Opens a PRIOR attempt from the retry-history list — same route as any other job, just reachable from here too. */
  protected openAttempt(attemptId: string): void {
    this.router.navigate(['/app/ai/jobs', attemptId]);
  }

  protected statusTag(status: GenerationJob['status']): TagVariant {
    return STATUS_TAG[status];
  }
  protected statusLabel(status: GenerationJob['status']): string {
    return STATUS_LABEL[status];
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
