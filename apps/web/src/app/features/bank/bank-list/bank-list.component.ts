import { Component, DestroyRef, inject, signal } from '@angular/core';
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
  private readonly destroyRef = inject(DestroyRef);

  protected readonly difficulties = Object.values(Difficulty);
  protected readonly gradeLevels = GRADE_LEVELS;
  protected readonly gradeLevelLabels = GRADE_LEVEL_LABELS;

  protected readonly questions = signal<BankQuestion[]>([]);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  /** `imageAssetId` -> `blob:` object URL, populated lazily by `loadImages`. */
  protected readonly imageUrls = signal<Record<string, string>>({});
  /** Every object URL this component has ever created, revoked on destroy. */
  private readonly objectUrls: string[] = [];

  protected readonly filtersForm = this.formBuilder.nonNullable.group({
    courseId: [''],
    topicId: [''],
    difficulty: [''],
    gradeLevel: [''],
  });

  constructor() {
    this.search();
    this.destroyRef.onDestroy(() => {
      for (const url of this.objectUrls) {
        URL.revokeObjectURL(url);
      }
    });
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
          this.loadImages(questions);
        },
        error: (_error: HttpErrorResponse) => {
          this.loading.set(false);
          this.errorMessage.set('No se pudieron cargar las preguntas. Inténtalo de nuevo.');
        },
      });
  }

  /**
   * `GET /assets/:id` is Bearer-JWT protected, and a plain `<img src>`
   * never sends the Authorization header — binding `buildImageAssetUrl()`
   * directly to `<img src>` would 401. Instead: fetch the bytes through
   * `HttpClient` (the `authInterceptor` attaches the header automatically,
   * same as every other request this app makes) and turn the response into
   * a `blob:` object URL, which `<img>` CAN load without any header.
   */
  private loadImages(questions: readonly BankQuestion[]): void {
    for (const question of questions) {
      const assetId = question.imageAssetId;
      if (!assetId || this.imageUrls()[assetId]) {
        continue;
      }
      this.bankService.fetchQuestionImage(assetId).subscribe((blob) => {
        const url = URL.createObjectURL(blob);
        this.objectUrls.push(url);
        this.imageUrls.update((current) => ({ ...current, [assetId]: url }));
      });
    }
  }

  protected imageUrl(question: BankQuestion): string | null {
    return question.imageAssetId ? (this.imageUrls()[question.imageAssetId] ?? null) : null;
  }
}
