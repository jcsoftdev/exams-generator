import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Difficulty } from '@exams-generator/shared';
import { BankService } from '../bank.service';
import { BankQuestion, GRADE_LEVELS, GRADE_LEVEL_LABELS } from '../bank.models';

@Component({
  selector: 'app-bank-list',
  imports: [ReactiveFormsModule],
  templateUrl: './bank-list.component.html',
})
export class BankListComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly bankService = inject(BankService);

  protected readonly difficulties = Object.values(Difficulty);
  protected readonly gradeLevels = GRADE_LEVELS;
  protected readonly gradeLevelLabels = GRADE_LEVEL_LABELS;

  protected readonly questions = signal<BankQuestion[]>([]);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly filtersForm = this.formBuilder.nonNullable.group({
    courseId: [''],
    topicId: [''],
    difficulty: [''],
    gradeLevel: [''],
  });

  constructor() {
    this.search();
  }

  protected search(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    const raw = this.filtersForm.getRawValue();
    this.bankService
      .listQuestions({
        courseId: raw.courseId || undefined,
        topicId: raw.topicId || undefined,
        difficulty: (raw.difficulty || undefined) as Difficulty | undefined,
        gradeLevel: raw.gradeLevel || undefined,
      })
      .subscribe({
        next: (questions) => {
          this.questions.set(questions);
          this.loading.set(false);
        },
        error: (_error: HttpErrorResponse) => {
          this.loading.set(false);
          this.errorMessage.set('Could not load questions. Please try again.');
        },
      });
  }

  protected imageUrl(question: BankQuestion): string | null {
    return question.imageAssetId ? this.bankService.buildImageAssetUrl(question.imageAssetId) : null;
  }
}
