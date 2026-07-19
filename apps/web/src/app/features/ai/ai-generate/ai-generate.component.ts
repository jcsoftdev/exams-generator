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

  protected readonly hasResult = computed(() => this.requested() > 0);
  protected readonly createdCount = computed(() => this.allCreated().length);
  protected readonly failedCount = computed(() => this.failed().length);
  protected readonly resultPct = computed(() => {
    const total = this.requested();
    return total > 0 ? (this.createdCount() / total) * 100 : 0;
  });
  protected readonly batchDescription = computed(() => {
    const course = this.courses().find((c) => c.id === this.courseId())?.name;
    const topic = this.topics().find((t) => t.id === this.topicId())?.name;
    const diff = this.difficulty() ? DIFFICULTY_LABELS[this.difficulty()!] : undefined;
    const grade = this.gradeLevel() ? GRADE_LEVEL_LABELS[this.gradeLevel() as GradeLevel] : undefined;
    return [course, topic, diff, grade].filter((v): v is string => !!v).join(' · ');
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
    this.count.update((c) => Math.min(50, c + 1));
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
    this.run(this.count());
  }

  protected retryFailed(): void {
    const failedCount = this.failedCount();
    if (this.generating() || failedCount === 0) return;
    this.run(failedCount);
  }

  private run(count: number): void {
    this.generating.set(true);
    this.errorMessage.set(null);
    this.aiService
      .generateQuestions({
        courseId: this.courseId(),
        topicId: this.topicId(),
        difficulty: this.difficulty()!,
        gradeLevel: this.gradeLevel()!,
        count,
        withFigure: this.withFigure(),
      })
      .subscribe({
        next: (res: GenerateQuestionsResult) => {
          this.generating.set(false);
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
      const idSet = new Set(newIds);
      const newlyLoaded = drafts.filter((d) => idSet.has(d.id));
      this.batchQuestions.update((prev) => [...prev, ...newlyLoaded]);
    });
  }

  protected goToReview(): void {
    this.router.navigate(['/app/ai/review']);
  }
}
