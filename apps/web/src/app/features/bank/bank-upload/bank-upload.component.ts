import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Difficulty } from '@exams-generator/shared';
import { BankService } from '../bank.service';
import { GRADE_LEVELS, GRADE_LEVEL_LABELS } from '../bank.models';

@Component({
  selector: 'app-bank-upload',
  imports: [ReactiveFormsModule],
  templateUrl: './bank-upload.component.html',
})
export class BankUploadComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly bankService = inject(BankService);

  protected readonly difficulties = Object.values(Difficulty);
  protected readonly gradeLevels = GRADE_LEVELS;
  protected readonly gradeLevelLabels = GRADE_LEVEL_LABELS;

  protected readonly submitting = signal(false);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly selectedFile = signal<File | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    courseId: ['', [Validators.required]],
    topicId: ['', [Validators.required]],
    difficulty: ['', [Validators.required]],
    gradeLevel: ['', [Validators.required]],
    correctAnswer: ['', [Validators.required]],
  });

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
  }

  protected onSubmit(): void {
    const file = this.selectedFile();
    if (this.form.invalid || !file || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.successMessage.set(null);
    this.errorMessage.set(null);
    this.submitting.set(true);

    const raw = this.form.getRawValue();

    this.bankService
      .uploadImageQuestion({
        courseId: raw.courseId,
        topicId: raw.topicId,
        difficulty: raw.difficulty as Difficulty,
        gradeLevel: raw.gradeLevel,
        correctAnswer: raw.correctAnswer,
        image: file,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.successMessage.set('Question uploaded successfully.');
          this.form.reset();
          this.selectedFile.set(null);
        },
        error: (error: HttpErrorResponse) => {
          this.submitting.set(false);
          this.errorMessage.set(
            Array.isArray(error.error)
              ? error.error.join(', ')
              : 'Could not upload the question. Please try again.',
          );
        },
      });
  }
}
