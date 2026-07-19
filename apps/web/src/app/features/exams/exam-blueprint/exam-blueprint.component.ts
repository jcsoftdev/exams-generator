import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Component, WritableSignal, inject, output, signal } from '@angular/core';
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
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';

/**
 * Blueprint builder (design doc §5.3 steps 1-2). Lets a teacher define an
 * exam's title/grade level plus N blueprint rows ("X questions of
 * {course, topic?, difficulty?}"), then calls `POST /exams`.
 *
 * Course/topic are dropdowns populated from `TaxonomyService`
 * (`GET /courses`, `GET /topics?courseId=`). Each row's topic list is
 * cascaded from ITS OWN course selection — topics are tracked in a
 * `WeakMap` keyed by the row's `FormGroup` instance (not by index), so
 * adding/removing rows never mixes up which topics belong to which row.
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
  private readonly taxonomyService = inject(TaxonomyService);

  protected readonly difficulties = Object.values(Difficulty);
  protected readonly gradeLevels = GRADE_LEVELS;
  protected readonly gradeLevelLabels = GRADE_LEVEL_LABELS;

  protected readonly courses = signal<Course[]>([]);
  private readonly rowTopics = new WeakMap<AbstractControl, WritableSignal<Topic[]>>();
  // Mirrors `form.controls.gradeLevel.value`, tracked outside the form
  // itself so `buildRow()` (referenced from `form`'s own field initializer,
  // building the first row) never reads `this.form` — doing so creates a
  // circular type-inference error (TS7022) since `form`'s type would depend
  // on `buildRow()`'s return type, which would depend on `form`'s type.
  private currentGradeLevel: string | null = null;

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly shortages = signal<readonly ShortageDetail[]>([]);

  readonly examCreated = output<CreateExamResult>();

  protected readonly form = this.formBuilder.nonNullable.group({
    title: ['', [Validators.required]],
    gradeLevel: ['', [Validators.required]],
    blueprint: this.formBuilder.array([this.buildRow()]),
  });

  constructor() {
    // Courses are loaded per selected grade — the catalog is divided by
    // educational stage, so loading it up front (no grade) would list every
    // stage's courses at once and repeat shared names (Matemática,
    // Comunicación…) once per stage. Picking a grade first scopes the
    // dropdown to one stage (same fix as ai-generate.component.ts). Since
    // `gradeLevel` is exam-level (not per-row), a grade change resets every
    // row's course/topic selection — a row can't keep referencing a course
    // from a stage that's no longer selected.
    this.form.controls.gradeLevel.valueChanges.subscribe((gradeLevel) => {
      this.currentGradeLevel = gradeLevel;
      this.courses.set([]);
      for (const row of this.rows.controls) {
        row.controls.courseId.setValue('');
        row.controls.topicId.setValue('');
        this.rowTopics.get(row)?.set([]);
        if (gradeLevel) {
          row.controls.courseId.enable();
        } else {
          row.controls.courseId.disable();
        }
      }
      if (!gradeLevel) {
        return;
      }
      this.taxonomyService.getCourses(gradeLevel).subscribe((courses) => this.courses.set(courses));
    });
  }

  protected get rows() {
    return this.form.controls.blueprint;
  }

  private buildRow() {
    // Curso starts disabled until a grade level is picked — [disabled] on a
    // native <select> fights the reactive-forms directive (it wins and
    // resets the DOM property), so it's gated via
    // FormControl.disable()/enable() instead of a template binding.
    const gradeLevelAlreadySet = !!this.currentGradeLevel;
    const row = this.formBuilder.nonNullable.group({
      courseId: [{ value: '', disabled: !gradeLevelAlreadySet }, [Validators.required]],
      topicId: [''],
      difficulty: [''],
      count: [1, [Validators.required, Validators.min(1)]],
    });

    const topics = signal<Topic[]>([]);
    this.rowTopics.set(row, topics);

    row.controls.courseId.valueChanges.subscribe((courseId) => {
      row.controls.topicId.setValue('');
      if (!courseId) {
        topics.set([]);
        return;
      }
      this.taxonomyService
        .getTopics(courseId, this.currentGradeLevel || undefined)
        .subscribe((result) => topics.set(result));
    });

    return row;
  }

  /** Keyed by the row's `FormGroup` (stable across add/remove), not by index. */
  protected topicsForRow(row: AbstractControl): Topic[] {
    return this.rowTopics.get(row)?.() ?? [];
  }

  protected addRow(): void {
    this.rows.push(this.buildRow());
  }

  protected removeRow(index: number): void {
    if (this.rows.length > 1) {
      this.rowTopics.delete(this.rows.at(index));
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
