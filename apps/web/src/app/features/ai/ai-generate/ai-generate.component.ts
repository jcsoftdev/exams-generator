import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Difficulty } from '@exams-generator/shared';
import { AiService } from '../ai.service';
import { GRADE_LEVELS, GRADE_LEVEL_LABELS, GenerateQuestionsResult } from '../ai.models';

/**
 * Generation-by-topic form (design doc §5.2 step 1): course/topic/
 * difficulty/gradeLevel/count/withFigure → `POST /ai/questions/generate`.
 * The request is a BATCH with partial failure — some questions can fail
 * (e.g. invalid Typst markup from the model) while others are created as
 * drafts, so the result always shows both counts plus the per-failure
 * reason (never a single pass/fail outcome).
 */
@Component({
  selector: 'app-ai-generate',
  imports: [ReactiveFormsModule],
  templateUrl: './ai-generate.component.html',
})
export class AiGenerateComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly aiService = inject(AiService);

  protected readonly difficulties = Object.values(Difficulty);
  protected readonly gradeLevels = GRADE_LEVELS;
  protected readonly gradeLevelLabels = GRADE_LEVEL_LABELS;

  protected readonly submitting = signal(false);
  protected readonly result = signal<GenerateQuestionsResult | null>(null);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    courseId: ['', [Validators.required]],
    topicId: ['', [Validators.required]],
    difficulty: ['', [Validators.required]],
    gradeLevel: ['', [Validators.required]],
    count: [1, [Validators.required, Validators.min(1)]],
    withFigure: [false],
  });

  protected onSubmit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.result.set(null);
    this.errorMessage.set(null);
    this.submitting.set(true);

    const raw = this.form.getRawValue();

    this.aiService
      .generateQuestions({
        courseId: raw.courseId,
        topicId: raw.topicId,
        difficulty: raw.difficulty as Difficulty,
        gradeLevel: raw.gradeLevel,
        count: raw.count,
        withFigure: raw.withFigure,
      })
      .subscribe({
        next: (response) => {
          this.submitting.set(false);
          this.result.set(response);
        },
        error: (_error: HttpErrorResponse) => {
          this.submitting.set(false);
          this.errorMessage.set('Could not generate questions. Please try again.');
        },
      });
  }
}
