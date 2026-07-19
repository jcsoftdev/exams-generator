import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Difficulty } from '@exams-generator/shared';
import { BankService } from '../bank.service';
import { GRADE_LEVELS, GRADE_LEVEL_LABELS } from '../bank.models';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';

@Component({
  selector: 'app-bank-upload',
  imports: [ReactiveFormsModule],
  templateUrl: './bank-upload.component.html',
})
export class BankUploadComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly bankService = inject(BankService);
  private readonly taxonomyService = inject(TaxonomyService);

  protected readonly difficulties = Object.values(Difficulty);
  protected readonly gradeLevels = GRADE_LEVELS;
  protected readonly gradeLevelLabels = GRADE_LEVEL_LABELS;

  protected readonly courses = signal<Course[]>([]);
  protected readonly topics = signal<Topic[]>([]);

  protected readonly submitting = signal(false);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly selectedFile = signal<File | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    // Starts disabled: a native <select> combined with [disabled] AND
    // formControlName fights the reactive-forms directive (it wins and
    // resets the DOM property), so Curso is gated via
    // FormControl.disable()/enable() below instead of a template binding.
    courseId: [{ value: '', disabled: true }, [Validators.required]],
    topicId: ['', [Validators.required]],
    difficulty: ['', [Validators.required]],
    gradeLevel: ['', [Validators.required]],
    correctAnswer: ['', [Validators.required]],
  });

  constructor() {
    // Courses are loaded per selected grade — the catalog is divided by
    // educational stage, so loading it up front (no grade) would list every
    // stage's courses at once and repeat shared names (Matemática,
    // Comunicación…) once per stage. Picking a grade first scopes the
    // dropdown to one stage (same fix as ai-generate.component.ts).
    this.form.controls.gradeLevel.valueChanges.subscribe((gradeLevel) => {
      this.form.controls.courseId.setValue('');
      this.form.controls.topicId.setValue('');
      this.courses.set([]);
      this.topics.set([]);
      if (!gradeLevel) {
        this.form.controls.courseId.disable();
        return;
      }
      this.form.controls.courseId.enable();
      this.taxonomyService.getCourses(gradeLevel).subscribe((courses) => this.courses.set(courses));
    });

    this.form.controls.courseId.valueChanges.subscribe((courseId) => {
      this.form.controls.topicId.setValue('');
      if (!courseId) {
        this.topics.set([]);
        return;
      }
      this.taxonomyService
        .getTopics(courseId, this.form.controls.gradeLevel.value || undefined)
        .subscribe((topics) => this.topics.set(topics));
    });
  }

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
          this.successMessage.set('Pregunta subida correctamente.');
          this.form.reset();
          this.selectedFile.set(null);
        },
        error: (error: HttpErrorResponse) => {
          this.submitting.set(false);
          this.errorMessage.set(
            Array.isArray(error.error)
              ? error.error.join(', ')
              : 'No se pudo subir la pregunta. Inténtalo de nuevo.',
          );
        },
      });
  }
}
