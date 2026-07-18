import { Component, inject, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Difficulty } from '@exams-generator/shared';
import { ExamsService } from '../exams.service';
import {
  CreateExamResult,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
  InsufficientStockErrorBody,
  ShortageDetail,
} from '../exams.models';

/**
 * Blueprint builder (design doc §5.3 steps 1-2). Lets a teacher define an
 * exam's title/grade level plus N blueprint rows ("X questions of
 * {course, topic?, difficulty?}"), then calls `POST /exams`.
 *
 * GAP: there is no `GET /courses`/`GET /topics` listing endpoint, so
 * `courseId`/`topicId` are free-text UUID inputs (same workaround as
 * `BankListComponent`'s filters) — see exams.models.ts.
 *
 * On a 422 (`InsufficientQuestionStockError`), the backend still persists
 * the exam and its blueprint rows so the user can fix and retry — this
 * component surfaces each failing row's shortage inline instead of losing
 * the form state.
 */
@Component({
  selector: 'app-exam-blueprint',
  imports: [ReactiveFormsModule],
  templateUrl: './exam-blueprint.component.html',
})
export class ExamBlueprintComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly examsService = inject(ExamsService);

  protected readonly difficulties = Object.values(Difficulty);
  protected readonly gradeLevels = GRADE_LEVELS;
  protected readonly gradeLevelLabels = GRADE_LEVEL_LABELS;

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly shortages = signal<readonly ShortageDetail[]>([]);

  readonly examCreated = output<CreateExamResult>();

  protected readonly form = this.formBuilder.nonNullable.group({
    title: ['', [Validators.required]],
    gradeLevel: ['', [Validators.required]],
    blueprint: this.formBuilder.array([this.buildRow()]),
  });

  protected get rows() {
    return this.form.controls.blueprint;
  }

  private buildRow() {
    return this.formBuilder.nonNullable.group({
      courseId: ['', [Validators.required]],
      topicId: [''],
      difficulty: [''],
      count: [1, [Validators.required, Validators.min(1)]],
    });
  }

  protected addRow(): void {
    this.rows.push(this.buildRow());
  }

  protected removeRow(index: number): void {
    if (this.rows.length > 1) {
      this.rows.removeAt(index);
    }
  }

  /**
   * Matches a shortage returned by the API back to the row that produced it
   * so the template can highlight it inline. The server assigns its own
   * `blueprintRowId` (a DB id we never see client-side before submit), so
   * rows are correlated by the same courseId/topicId/difficulty triple we
   * sent — reliable because rows are submitted, and shortages returned, in
   * the same order.
   */
  protected shortageForRow(index: number): ShortageDetail | undefined {
    const row = this.rows.at(index).getRawValue();
    return this.shortages().find(
      (shortage) =>
        shortage.courseId === row.courseId &&
        (shortage.topicId ?? '') === (row.topicId || '') &&
        (shortage.difficulty ?? '') === (row.difficulty || ''),
    );
  }

  protected onSubmit(): void {
    if (this.form.invalid || this.rows.length === 0 || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.errorMessage.set(null);
    this.shortages.set([]);
    this.submitting.set(true);

    const raw = this.form.getRawValue();

    this.examsService
      .createExam({
        title: raw.title,
        gradeLevel: raw.gradeLevel,
        blueprint: raw.blueprint.map((row) => ({
          courseId: row.courseId,
          topicId: row.topicId || undefined,
          difficulty: (row.difficulty || undefined) as Difficulty | undefined,
          count: Number(row.count),
        })),
      })
      .subscribe({
        next: (result) => {
          this.submitting.set(false);
          this.examCreated.emit(result);
        },
        error: (error: HttpErrorResponse) => {
          this.submitting.set(false);
          if (error.status === 422) {
            const body = error.error as InsufficientStockErrorBody;
            this.shortages.set(body.shortages ?? []);
            this.errorMessage.set(body.message ?? 'Insufficient question stock for one or more rows.');
          } else {
            this.errorMessage.set('Could not create the exam. Please try again.');
          }
        },
      });
  }
}
