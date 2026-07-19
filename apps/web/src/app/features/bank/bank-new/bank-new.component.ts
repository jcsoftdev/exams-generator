import { Component, computed, effect, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Difficulty } from '@exams-generator/shared';
import { LucideAngularModule, Upload, Image as ImageIcon } from 'lucide-angular';
import { ButtonComponent } from '../../../ui/button/button.component';
import { InputComponent } from '../../../ui/input/input.component';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { BankService } from '../bank.service';
import { GRADE_LEVELS, GRADE_LEVEL_LABELS } from '../bank.models';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: 'Fácil',
  [Difficulty.Medium]: 'Media',
  [Difficulty.Hard]: 'Difícil',
};
type Tab = 'photo' | 'structured';

function toOptions(items: readonly { id: string; name: string }[]): SelectOption<string>[] {
  return items.map((item) => ({ value: item.id, label: item.name }));
}

/**
 * Task 6: "Nueva pregunta" creator with two tabs — "Foto de la pregunta"
 * (existing `POST /bank/questions/image` multipart upload) and "Escribir
 * pregunta" (new `POST /bank/questions/structured` JSON payload). Route
 * `/app/bank/new`, replaces the old single-form `bank-upload` screen as the
 * primary entry point (see Task 5's "nueva pregunta" nav target).
 *
 * UI redesign follow-up: Curso/Tema are dependent `ui-select` dropdowns
 * sourced from `TaxonomyService` (never raw UUID text inputs — submits the
 * selected ids). The photo tab's file input is a styled click/drag upload
 * control with filename + thumbnail preview instead of the native
 * "Choose File" button.
 */
@Component({
  selector: 'app-bank-new',
  standalone: true,
  imports: [ButtonComponent, InputComponent, SelectComponent, LucideAngularModule],
  providers: [LucideAngularModule.pick({ Upload, Image: ImageIcon }).providers ?? []],
  templateUrl: './bank-new.component.html',
})
export class BankNewComponent {
  private readonly bankService = inject(BankService);
  private readonly taxonomyService = inject(TaxonomyService);
  private readonly router = inject(Router);

  protected readonly gradeLevelOptions = GRADE_LEVELS.map((g) => ({
    value: g,
    label: GRADE_LEVEL_LABELS[g],
  }));
  protected readonly difficultyOptions = Object.values(Difficulty).map((d) => ({
    value: d,
    label: DIFFICULTY_LABELS[d],
  }));

  protected readonly tab = signal<Tab>('photo');
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly courses = signal<Course[]>([]);
  protected readonly courseOptions = computed(() => toOptions(this.courses()));

  // Foto
  protected readonly pCourseId = signal('');
  protected readonly pTopicId = signal('');
  protected readonly pTopics = signal<Topic[]>([]);
  protected readonly pTopicOptions = computed(() => toOptions(this.pTopics()));
  protected readonly pDifficulty = signal<Difficulty | null>(null);
  protected readonly pGradeLevel = signal<string | null>(null);
  protected readonly pCorrectAnswer = signal('');
  protected readonly pImage = signal<File | null>(null);
  protected readonly pImagePreviewUrl = signal<string | null>(null);

  // Estructurada
  protected readonly sCourseId = signal('');
  protected readonly sTopicId = signal('');
  protected readonly sTopics = signal<Topic[]>([]);
  protected readonly sTopicOptions = computed(() => toOptions(this.sTopics()));
  protected readonly sDifficulty = signal<Difficulty | null>(null);
  protected readonly sGradeLevel = signal<string | null>(null);
  protected readonly sBody = signal('');
  protected readonly sAlternatives = signal('');
  protected readonly sCorrectAnswer = signal('');

  constructor() {
    this.taxonomyService.getCourses().subscribe({
      next: (courses) => this.courses.set(courses),
      error: () => this.saveError.set('No se pudieron cargar los cursos. Recarga la página.'),
    });

    // Dependent Tema dropdown (photo tab): reloads whenever the course
    // changes, resets the previously selected topic so it never leaks
    // across courses.
    effect(() => {
      const courseId = this.pCourseId();
      this.pTopicId.set('');
      this.pTopics.set([]);
      if (!courseId) return;
      this.taxonomyService.getTopics(courseId).subscribe({
        next: (topics) => this.pTopics.set(topics),
        error: () => this.saveError.set('No se pudieron cargar los temas. Inténtalo de nuevo.'),
      });
    });

    // Same dependent behavior for the structured tab.
    effect(() => {
      const courseId = this.sCourseId();
      this.sTopicId.set('');
      this.sTopics.set([]);
      if (!courseId) return;
      this.taxonomyService.getTopics(courseId).subscribe({
        next: (topics) => this.sTopics.set(topics),
        error: () => this.saveError.set('No se pudieron cargar los temas. Inténtalo de nuevo.'),
      });
    });
  }

  protected setTab(t: Tab): void {
    this.tab.set(t);
    this.saveError.set(null);
  }

  protected onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.setImage(input.files?.[0] ?? null);
  }

  private setImage(file: File | null): void {
    const previous = this.pImagePreviewUrl();
    if (previous) {
      URL.revokeObjectURL(previous);
    }
    this.pImage.set(file);
    this.pImagePreviewUrl.set(file ? URL.createObjectURL(file) : null);
  }

  private photoValid(): boolean {
    return (
      !!this.pCourseId() &&
      !!this.pTopicId() &&
      !!this.pDifficulty() &&
      !!this.pGradeLevel() &&
      !!this.pCorrectAnswer() &&
      !!this.pImage()
    );
  }

  protected submitPhoto(): void {
    if (this.saving() || !this.photoValid()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.bankService
      .uploadImageQuestion({
        courseId: this.pCourseId(),
        topicId: this.pTopicId(),
        difficulty: this.pDifficulty()!,
        gradeLevel: this.pGradeLevel()!,
        correctAnswer: this.pCorrectAnswer(),
        image: this.pImage()!,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.router.navigate(['/app/bank']);
        },
        error: (_e: HttpErrorResponse) => {
          this.saving.set(false);
          this.saveError.set('No se pudo guardar la pregunta. Revisa los datos e inténtalo de nuevo.');
        },
      });
  }

  private structuredValid(): boolean {
    return (
      !!this.sCourseId() &&
      !!this.sTopicId() &&
      !!this.sDifficulty() &&
      !!this.sGradeLevel() &&
      !!this.sBody().trim() &&
      this.alternativesList().length >= 2 &&
      !!this.sCorrectAnswer()
    );
  }

  private alternativesList(): string[] {
    return this.sAlternatives()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  protected submitStructured(): void {
    if (this.saving() || !this.structuredValid()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.bankService
      .createStructuredQuestion({
        courseId: this.sCourseId(),
        topicId: this.sTopicId(),
        difficulty: this.sDifficulty()!,
        gradeLevel: this.sGradeLevel()!,
        correctAnswer: this.sCorrectAnswer(),
        bodyTypst: this.sBody(),
        alternatives: this.alternativesList(),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.router.navigate(['/app/bank']);
        },
        error: (_e: HttpErrorResponse) => {
          this.saving.set(false);
          this.saveError.set('No se pudo guardar la pregunta. Revisa los datos e inténtalo de nuevo.');
        },
      });
  }
}
