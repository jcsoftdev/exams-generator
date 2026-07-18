import { Component, DestroyRef, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Difficulty } from '@exams-generator/shared';
import { Router } from '@angular/router';
import { ButtonComponent } from '../../../ui/button/button.component';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { InputComponent } from '../../../ui/input/input.component';
import { SelectComponent } from '../../../ui/select/select.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { TagVariant } from '../../../ui/ui.types';
import { BankService } from '../bank.service';
import { BankQuestion, GRADE_LEVELS, GRADE_LEVEL_LABELS } from '../bank.models';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: 'Fácil',
  [Difficulty.Medium]: 'Media',
  [Difficulty.Hard]: 'Difícil',
};

/** Maps bank difficulty values to the design-system tag's semantic variants (QB-R1). */
const DIFFICULTY_TAG_VARIANT: Record<Difficulty, TagVariant> = {
  [Difficulty.Easy]: 'easy',
  [Difficulty.Medium]: 'medium',
  [Difficulty.Hard]: 'hard',
};

/**
 * Question-bank list screen (design doc §4, spec QB-R1..R3). Redesigned with
 * `ui/*` primitives — free-text course/topic filters plus difficulty/grado
 * selects, difficulty tags per question, and thumbnails fetched as
 * authenticated blobs (see `loadImages` — `/assets/:id` is Bearer-JWT
 * protected, a raw `<img src>` never sends that header).
 *
 * Distinguishes TWO empty states (QB-R2): "banco vacío" (the tenant's bank
 * has zero questions at all, regardless of filters) vs "sin resultados"
 * (the bank has questions, but the current filters match none). This is
 * tracked via `bankHasAnyQuestions`, set `true` the first time ANY
 * `listQuestions()` response — filtered or not — returns a non-empty array.
 */
@Component({
  selector: 'app-bank-list',
  standalone: true,
  imports: [ButtonComponent, EmptyStateComponent, InputComponent, SelectComponent, TagComponent],
  templateUrl: './bank-list.component.html',
})
export class BankListComponent {
  private readonly bankService = inject(BankService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  protected readonly difficulties = Object.values(Difficulty);
  protected readonly difficultyLabels = DIFFICULTY_LABELS;
  protected readonly gradeLevelOptions = GRADE_LEVELS.map((gradeLevel) => ({
    value: gradeLevel,
    label: GRADE_LEVEL_LABELS[gradeLevel],
  }));
  protected readonly difficultyOptions = this.difficulties.map((difficulty) => ({
    value: difficulty,
    label: DIFFICULTY_LABELS[difficulty],
  }));

  protected readonly courseId = signal('');
  protected readonly topicId = signal('');
  protected readonly difficulty = signal<Difficulty | null>(null);
  protected readonly gradeLevel = signal<string | null>(null);

  protected readonly questions = signal<BankQuestion[]>([]);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  /** Set true the first time ANY response (filtered or not) is non-empty — drives QB-R2's two-empty-states split. */
  protected readonly bankHasAnyQuestions = signal(false);

  /** `imageAssetId` -> `blob:` object URL, populated lazily by `loadImages`. */
  protected readonly imageUrls = signal<Record<string, string>>({});
  /** Every object URL this component has ever created, revoked on destroy. */
  private readonly objectUrls: string[] = [];

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
    this.questions.set([]);

    this.bankService
      .listQuestions({
        courseId: this.courseId() || undefined,
        topicId: this.topicId() || undefined,
        difficulty: this.difficulty() ?? undefined,
        gradeLevel: this.gradeLevel() ?? undefined,
      })
      .subscribe({
        next: (questions) => {
          this.loading.set(false);
          this.questions.set(questions);
          if (questions.length > 0) {
            this.bankHasAnyQuestions.set(true);
          }
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

  protected tagVariantFor(difficulty: Difficulty): TagVariant {
    return DIFFICULTY_TAG_VARIANT[difficulty];
  }

  protected goToUpload(): void {
    this.router.navigate(['/app/bank/upload']);
  }
}
