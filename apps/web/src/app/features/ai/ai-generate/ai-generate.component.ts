import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Difficulty } from '@exams-generator/shared';
import { LucideAngularModule, Sparkles, Plus, Minus, Check, ChevronDown } from 'lucide-angular';
import { ButtonComponent } from '../../../ui/button/button.component';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { BannerComponent } from '../../../ui/banner/banner.component';
import { AiService } from '../ai.service';
import { GRADE_LEVELS, GRADE_LEVEL_LABELS } from '../ai.models';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: 'Fácil',
  [Difficulty.Medium]: 'Media',
  [Difficulty.Hard]: 'Difícil',
};

const MAX_STEPPER_COUNT = 10;

/**
 * Form-only generator (design doc:
 * docs/superpowers/specs/2026-07-19-ai-generation-history-design.md §6).
 * `generate()` creates ONE durable job server-side and navigates to its
 * detail screen — the client no longer orchestrates a per-item loop or
 * tracks batch progress itself; `GenerationJobDetailComponent` does that by
 * polling.
 */
@Component({
  selector: 'app-ai-generate',
  standalone: true,
  imports: [ButtonComponent, SelectComponent, BannerComponent, LucideAngularModule],
  // `ui-select` (Grado/Curso/Tema) needs Check + ChevronDown — this
  // component-level `.pick()` shadows the root `app.config.ts` registration.
  providers: [LucideAngularModule.pick({ Sparkles, Plus, Minus, Check, ChevronDown }).providers ?? []],
  templateUrl: './ai-generate.component.html',
})
export class AiGenerateComponent {
  private readonly aiService = inject(AiService);
  private readonly taxonomyService = inject(TaxonomyService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

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

  protected readonly courseId = signal('');
  protected readonly topicId = signal('');
  protected readonly difficulty = signal<Difficulty | null>(null);
  protected readonly gradeLevel = signal<string | null>(null);
  protected readonly count = signal(5);
  protected readonly withFigure = signal(false);

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  constructor() {
    const params = this.route.snapshot.queryParamMap;
    const gradeLevel = params.get('gradeLevel');
    const courseId = params.get('courseId');
    const topicId = params.get('topicId');
    const difficulty = params.get('difficulty');

    if (gradeLevel) {
      this.onGradeLevelChange(gradeLevel);
    }
    if (courseId) {
      this.onCourseChange(courseId);
    }
    if (topicId) {
      this.topicId.set(topicId);
    }
    if (difficulty && (Object.values(Difficulty) as string[]).includes(difficulty)) {
      this.difficulty.set(difficulty as Difficulty);
    }
  }

  protected onGradeLevelChange(gradeLevel: string | null): void {
    this.gradeLevel.set(gradeLevel);
    this.courseId.set('');
    this.topicId.set('');
    this.topics.set([]);
    this.courses.set([]);
    if (gradeLevel) {
      this.taxonomyService.getCourses(gradeLevel).subscribe((courses) => this.courses.set(courses));
    }
  }

  protected onCourseChange(courseId: string | null): void {
    const id = courseId ?? '';
    this.courseId.set(id);
    this.topicId.set('');
    this.topics.set([]);
    if (id) {
      this.taxonomyService
        .getTopics(id, this.gradeLevel() ?? undefined)
        .subscribe((topics) => this.topics.set(topics));
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

  protected valid(): boolean {
    return !!this.courseId() && !!this.topicId() && !!this.difficulty() && !!this.gradeLevel() && this.count() > 0;
  }

  protected generate(): void {
    if (this.submitting() || !this.valid()) return;
    this.submitting.set(true);
    this.errorMessage.set(null);
    this.aiService
      .createGenerationJob({
        courseId: this.courseId(),
        topicId: this.topicId(),
        difficulty: this.difficulty()!,
        gradeLevel: this.gradeLevel()!,
        count: this.count(),
        withFigure: this.withFigure(),
      })
      .subscribe({
        next: (job) => this.router.navigate(['/app/ai/jobs', job.id]),
        error: (_e: HttpErrorResponse) => {
          this.submitting.set(false);
          this.errorMessage.set('No se pudo iniciar la generación. Inténtalo de nuevo.');
        },
      });
  }

  protected goToHistory(): void {
    this.router.navigate(['/app/ai/jobs']);
  }
}
