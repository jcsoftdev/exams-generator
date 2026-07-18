import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Difficulty } from '@exams-generator/shared';
import { ButtonComponent } from '../../../ui/button/button.component';
import { InputComponent } from '../../../ui/input/input.component';
import { SelectComponent } from '../../../ui/select/select.component';
import { BankService } from '../bank.service';
import { GRADE_LEVELS, GRADE_LEVEL_LABELS } from '../bank.models';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: 'Fácil',
  [Difficulty.Medium]: 'Media',
  [Difficulty.Hard]: 'Difícil',
};
type Tab = 'photo' | 'structured';

/**
 * Task 6: "Nueva pregunta" creator with two tabs — "Foto de la pregunta"
 * (existing `POST /bank/questions/image` multipart upload) and "Escribir
 * pregunta" (new `POST /bank/questions/structured` JSON payload). Route
 * `/app/bank/new`, replaces the old single-form `bank-upload` screen as the
 * primary entry point (see Task 5's "nueva pregunta" nav target).
 */
@Component({
  selector: 'app-bank-new',
  standalone: true,
  imports: [ButtonComponent, InputComponent, SelectComponent],
  templateUrl: './bank-new.component.html',
})
export class BankNewComponent {
  private readonly bankService = inject(BankService);
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

  // Foto
  protected readonly pCourseId = signal('');
  protected readonly pTopicId = signal('');
  protected readonly pDifficulty = signal<Difficulty | null>(null);
  protected readonly pGradeLevel = signal<string | null>(null);
  protected readonly pCorrectAnswer = signal('');
  protected readonly pImage = signal<File | null>(null);

  // Estructurada
  protected readonly sCourseId = signal('');
  protected readonly sTopicId = signal('');
  protected readonly sDifficulty = signal<Difficulty | null>(null);
  protected readonly sGradeLevel = signal<string | null>(null);
  protected readonly sBody = signal('');
  protected readonly sAlternatives = signal('');
  protected readonly sCorrectAnswer = signal('');

  protected setTab(t: Tab): void {
    this.tab.set(t);
    this.saveError.set(null);
  }

  protected onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.pImage.set(input.files?.[0] ?? null);
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
