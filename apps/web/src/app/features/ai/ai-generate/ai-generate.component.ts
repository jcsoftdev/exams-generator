import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Difficulty } from '@exams-generator/shared';
import { LucideAngularModule, Sparkles, TriangleAlert, Plus, Minus } from 'lucide-angular';
import { ButtonComponent } from '../../../ui/button/button.component';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { ProgressComponent } from '../../../ui/progress/progress.component';
import { BannerComponent } from '../../../ui/banner/banner.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { AiService } from '../ai.service';
import { DraftCountService } from '../draft-count.service';
import {
  DraftQuestion,
  GenerateQuestionsCreatedItem,
  GenerateQuestionsFailedItem,
  GenerateQuestionsResult,
  GradeLevel,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
} from '../ai.models';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: 'Fácil',
  [Difficulty.Medium]: 'Media',
  [Difficulty.Hard]: 'Difícil',
};

const ALTERNATIVE_LETTERS = ['a', 'b', 'c', 'd', 'e'];

// Mirrors the backend cap in validate-generate-questions-input.ts (MAX_COUNT).
// POST /ai/questions/generate rejects count > 10 with a 400.
const MAX_STEPPER_COUNT = 10;

interface GenerateSnapshot {
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly withFigure: boolean;
  readonly courseName?: string;
  readonly topicName?: string;
}

/**
 * Taller layout (Task 9, mockup `ia-generar-v2.html` option A-taller): a
 * persistent form on the left (never resets — you tweak and re-ask without
 * re-filling) and the current batch ("tanda") on the right. The
 * `POST /ai/questions/generate` response only carries created ids (see
 * `ai.models.ts`), so the readable question cards (stem/alternatives/clave)
 * are enriched via `AiService.listDrafts()` after a successful batch.
 */
@Component({
  selector: 'app-ai-generate',
  standalone: true,
  imports: [ButtonComponent, SelectComponent, ProgressComponent, BannerComponent, TagComponent, LucideAngularModule],
  providers: [LucideAngularModule.pick({ Sparkles, TriangleAlert, Plus, Minus }).providers ?? []],
  templateUrl: './ai-generate.component.html',
})
export class AiGenerateComponent {
  private readonly aiService = inject(AiService);
  private readonly taxonomyService = inject(TaxonomyService);
  private readonly router = inject(Router);
  private readonly draftCountService = inject(DraftCountService);

  protected readonly maxStepperCount = MAX_STEPPER_COUNT;

  protected readonly difficultyOptions: SelectOption<Difficulty>[] = Object.values(Difficulty).map((d) => ({
    value: d,
    label: DIFFICULTY_LABELS[d],
  }));
  protected readonly gradeLevelOptions: SelectOption<string>[] = GRADE_LEVELS.map((g) => ({
    value: g,
    label: GRADE_LEVEL_LABELS[g],
  }));

  protected readonly courses = signal<Course[]>([]);
  protected readonly topics = signal<Topic[]>([]);
  protected readonly courseOptions = computed<SelectOption<string>[]>(() =>
    this.courses().map((c) => ({ value: c.id, label: c.name })),
  );
  protected readonly topicOptions = computed<SelectOption<string>[]>(() =>
    this.topics().map((t) => ({ value: t.id, label: t.name })),
  );

  // Form — persistent, never reset after a generate/retry cycle.
  protected readonly courseId = signal('');
  protected readonly topicId = signal('');
  protected readonly difficulty = signal<Difficulty | null>(null);
  protected readonly gradeLevel = signal<string | null>(null);
  protected readonly count = signal(5);
  protected readonly withFigure = signal(false);

  // Batch state.
  protected readonly generating = signal(false);
  protected readonly requested = signal(0);
  protected readonly allCreated = signal<readonly GenerateQuestionsCreatedItem[]>([]);
  protected readonly failed = signal<readonly GenerateQuestionsFailedItem[]>([]);
  protected readonly batchQuestions = signal<readonly DraftQuestion[]>([]);
  protected readonly errorMessage = signal<string | null>(null);
  // The last GenerateQuestionsResult ever received (null until the first
  // successful response). Used as the guard for the status card so a total
  // failure (thrown error, no response) never renders it — only a fully
  // reset requested/errorMessage pair should, and requested() alone isn't a
  // safe guard because it's set *before* the request fires.
  protected readonly result = signal<GenerateQuestionsResult | null>(null);
  // Immutable snapshot of the params used for the request that produced the
  // current batch. Captured once in generate() and reused as-is by
  // retryFailed() — never re-read from the live form signals — so editing
  // the form after generating can't leak new params into a "Reintentar".
  private readonly lastRequest = signal<GenerateSnapshot | null>(null);

  protected readonly hasResult = computed(() => this.result() !== null);
  protected readonly createdCount = computed(() => this.allCreated().length);
  protected readonly failedCount = computed(() => this.failed().length);
  // A response arrived (200) but every question failed validation
  // (created=[], failed=N). Showing the "0/N preguntas generadas" status
  // card in that case is confusing — nothing was generated — so this guards
  // the template into showing only the warning banner + the empty state
  // instead of the status card. Partial failures (created > 0) are
  // unaffected and keep showing the status card + banner together.
  protected readonly totalFailure = computed(() => this.hasResult() && this.createdCount() === 0 && this.failedCount() > 0);
  protected readonly resultPct = computed(() => {
    const total = this.requested();
    return total > 0 ? (this.createdCount() / total) * 100 : 0;
  });
  protected readonly batchDescription = computed(() => {
    const snapshot = this.lastRequest();
    if (!snapshot) return '';
    const diff = DIFFICULTY_LABELS[snapshot.difficulty];
    const grade = GRADE_LEVEL_LABELS[snapshot.gradeLevel as GradeLevel];
    return [snapshot.courseName, snapshot.topicName, diff, grade].filter((v): v is string => !!v).join(' · ');
  });

  constructor() {
    this.taxonomyService.getCourses().subscribe((courses) => this.courses.set(courses));
  }

  protected onCourseChange(courseId: string | null): void {
    const id = courseId ?? '';
    this.courseId.set(id);
    this.topicId.set('');
    this.topics.set([]);
    if (id) {
      this.taxonomyService.getTopics(id).subscribe((topics) => this.topics.set(topics));
    }
  }

  protected onTopicChange(topicId: string | null): void {
    this.topicId.set(topicId ?? '');
  }

  protected decCount(): void {
    this.count.update((c) => Math.max(1, c - 1));
  }
  protected incCount(): void {
    this.count.update((c) => Math.min(MAX_STEPPER_COUNT, c + 1));
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

  private valid(): boolean {
    return !!this.courseId() && !!this.topicId() && !!this.difficulty() && !!this.gradeLevel() && this.count() > 0;
  }

  protected generate(): void {
    if (this.generating() || !this.valid()) return;
    this.requested.set(this.count());
    this.allCreated.set([]);
    this.failed.set([]);
    this.batchQuestions.set([]);
    this.result.set(null);
    this.lastRequest.set(this.captureSnapshot());
    this.run(this.count());
  }

  protected retryFailed(): void {
    const failedCount = this.failedCount();
    const snapshot = this.lastRequest();
    if (this.generating() || failedCount === 0 || !snapshot) return;
    this.run(failedCount);
  }

  private captureSnapshot(): GenerateSnapshot {
    return {
      courseId: this.courseId(),
      topicId: this.topicId(),
      difficulty: this.difficulty()!,
      gradeLevel: this.gradeLevel()!,
      withFigure: this.withFigure(),
      courseName: this.courses().find((c) => c.id === this.courseId())?.name,
      topicName: this.topics().find((t) => t.id === this.topicId())?.name,
    };
  }

  // `count` is the only per-call value: the initial request uses the form's
  // count, a retry uses the number of failed items. Every other param comes
  // from the immutable `lastRequest` snapshot — never from the live form
  // signals — so retryFailed() always resends what was actually requested.
  private run(count: number): void {
    const snapshot = this.lastRequest();
    if (!snapshot) return;
    this.generating.set(true);
    this.errorMessage.set(null);
    this.aiService
      .generateQuestions({
        courseId: snapshot.courseId,
        topicId: snapshot.topicId,
        difficulty: snapshot.difficulty,
        gradeLevel: snapshot.gradeLevel,
        count,
        withFigure: snapshot.withFigure,
      })
      .subscribe({
        next: (res: GenerateQuestionsResult) => {
          this.generating.set(false);
          this.result.set(res);
          this.allCreated.update((prev) => [...prev, ...res.created]);
          this.failed.set(res.failed);
          if (res.created.length > 0) {
            this.loadBatchQuestions(res.created.map((c) => c.id));
          }
        },
        error: (_e: HttpErrorResponse) => {
          this.generating.set(false);
          this.errorMessage.set('No se pudieron generar las preguntas. Inténtalo de nuevo.');
        },
      });
  }

  private loadBatchQuestions(newIds: string[]): void {
    this.aiService.listDrafts().subscribe((drafts) => {
      // Sync the sidebar "Cola de revisión · N" badge (DraftCountService) —
      // this response IS the full pending-drafts list, same shape the
      // review queue uses to keep the badge in sync, so it's a free update
      // (no extra request). Without this the badge only reflected the
      // queue's own approve/reject actions and drifted stale right after a
      // Taller generation added new drafts (F8 fix).
      this.draftCountService.set(drafts.length);
      const idSet = new Set(newIds);
      const newlyLoaded = drafts.filter((d) => idSet.has(d.id));
      this.batchQuestions.update((prev) => [...prev, ...newlyLoaded]);
    });
  }

  protected goToReview(): void {
    this.router.navigate(['/app/ai/review']);
  }
}
