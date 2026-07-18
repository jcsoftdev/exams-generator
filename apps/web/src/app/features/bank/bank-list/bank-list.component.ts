import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { Difficulty } from '@exams-generator/shared';
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

const PAGE_SIZE = 12;

/**
 * Question-bank screen (design doc §4, spec QB-R1..R3, Task 5): a 55%/45%
 * list + detail-panel split. Left column is the paginated list (reuses
 * `data-testid="bank-question"`, `loading-indicator`, `empty-bank`,
 * `empty-no-results`, `error-state`, `retry-button`, plus new
 * `bank-pagination`/`bank-page-prev`/`bank-page-next`); right column is the
 * `bank-panel` detail view with badges/metadata and gated actions
 * (`panel-edit`, `panel-archive`, `panel-delete`, `panel-readonly`).
 *
 * Distinguishes TWO empty states (QB-R2): "banco vacío" (the tenant's bank
 * has zero questions at all, regardless of filters) vs "sin resultados"
 * (the bank has questions, but the current filters match none). Tracked via
 * `bankHasAnyQuestions`, set `true` the first time ANY paginated response
 * (filtered or not) returns `total > 0`.
 *
 * Thumbnails are fetched as authenticated blobs (see `loadImages` —
 * `/assets/:id` is Bearer-JWT protected, a raw `<img src>` never sends that
 * header).
 *
 * Action gating (`canArchive`/`canDelete`/`isCentral`) mirrors the backend's
 * own rules (Lane D4: S4 archives only `approved`, S5 deletes only own
 * `draft`; `origin === 'central'`/`tenantId === null` is always read-only) —
 * this is UX gating only, the backend is still the source of truth and
 * re-validates on every call.
 */
@Component({
  selector: 'app-bank-list',
  standalone: true,
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    InputComponent,
    SelectComponent,
    TagComponent,
    LucideAngularModule,
  ],
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
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  /** Set true the first time ANY response (filtered or not) is non-empty — drives QB-R2's two-empty-states split. */
  protected readonly bankHasAnyQuestions = signal(false);

  protected readonly selected = signal<BankQuestion | null>(null);
  protected readonly actionError = signal<string | null>(null);

  /** `imageAssetId` -> `blob:` object URL, populated lazily by `loadImages`. */
  protected readonly imageUrls = signal<Record<string, string>>({});
  /** Every object URL this component has ever created, revoked on destroy. */
  private readonly objectUrls: string[] = [];

  protected readonly pageSize = PAGE_SIZE;
  protected readonly lastPage = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize)));

  constructor() {
    this.search();
    this.destroyRef.onDestroy(() => {
      for (const url of this.objectUrls) {
        URL.revokeObjectURL(url);
      }
    });
  }

  protected search(): void {
    this.page.set(1);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.questions.set([]);

    this.bankService
      .listQuestionsPaged(
        {
          courseId: this.courseId() || undefined,
          topicId: this.topicId() || undefined,
          difficulty: this.difficulty() ?? undefined,
          gradeLevel: this.gradeLevel() ?? undefined,
        },
        this.page(),
        this.pageSize,
      )
      .subscribe({
        next: (res) => {
          this.loading.set(false);
          this.questions.set([...res.items]);
          this.total.set(res.total);
          if (res.total > 0) {
            this.bankHasAnyQuestions.set(true);
          }
          this.loadImages(res.items);
        },
        error: (_error: HttpErrorResponse) => {
          this.loading.set(false);
          this.errorMessage.set('No se pudieron cargar las preguntas. Inténtalo de nuevo.');
        },
      });
  }

  protected retry(): void {
    this.load();
  }

  protected prevPage(): void {
    if (this.page() > 1) {
      this.page.update((p) => p - 1);
      this.load();
    }
  }

  protected nextPage(): void {
    if (this.page() < this.lastPage()) {
      this.page.update((p) => p + 1);
      this.load();
    }
  }

  protected select(question: BankQuestion): void {
    this.actionError.set(null);
    this.selected.set(question);
    this.bankService.getQuestion(question.id).subscribe({
      next: (full) => this.selected.set(full),
      error: () => {},
    });
  }

  protected isCentral(question: BankQuestion): boolean {
    return question.origin === 'central' || question.tenantId === null;
  }

  protected canArchive(question: BankQuestion): boolean {
    return !this.isCentral(question) && question.status === 'approved';
  }

  protected canDelete(question: BankQuestion): boolean {
    return !this.isCentral(question) && question.status === 'draft';
  }

  protected archive(question: BankQuestion): void {
    this.actionError.set(null);
    this.bankService.archiveQuestion(question.id).subscribe({
      next: () => {
        this.selected.set(null);
        this.load();
      },
      error: () => this.actionError.set('No se pudo archivar la pregunta. Inténtalo de nuevo.'),
    });
  }

  protected remove(question: BankQuestion): void {
    this.actionError.set(null);
    this.bankService.deleteQuestion(question.id).subscribe({
      next: () => {
        this.selected.set(null);
        this.load();
      },
      error: () => this.actionError.set('No se pudo borrar la pregunta. Inténtalo de nuevo.'),
    });
  }

  protected edit(question: BankQuestion): void {
    this.router.navigate(['/app/bank/new'], { queryParams: { edit: question.id } });
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

  protected difficultyLabel(difficulty: Difficulty): string {
    return DIFFICULTY_LABELS[difficulty];
  }

  protected goToNew(): void {
    this.router.navigate(['/app/bank/new']);
  }
}
