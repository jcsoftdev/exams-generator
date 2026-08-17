import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { ButtonComponent } from '../../../ui/button/button.component';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { ModalComponent } from '../../../ui/modal/modal.component';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { InputComponent } from '../../../ui/input/input.component';
import { PaginationComponent } from '../../../ui/pagination/pagination.component';
import { TagVariant } from '../../../ui/ui.types';
import { ExamsService } from '../exams.service';
import { ExamListItem, ExamStatus, GRADE_LEVELS, GRADE_LEVEL_LABELS, GradeLevel } from '../exams.models';

/** Debounce delay (ms) for the título search box (spec §2.1) before re-fetching the list. */
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_OPTIONS: readonly SelectOption<ExamStatus>[] = [
  { value: 'draft', label: 'Borrador' },
  { value: 'ready', label: 'Generado' },
];

/**
 * "Mis exámenes" — historial index screen (Task F7). Replaces the F3 stub.
 * Mockup: option B-detalle in
 * .superpowers/brainstorm/13165-1784402344/content/historial-layout.html —
 * a clean row-card list; opening a `ready` exam goes to its versions detail
 * (S1/B4), a `draft` continues in the builder. Duplicate (S2) always lands
 * on a fresh draft in the builder; delete (S3) skips confirmation for
 * drafts (nothing to lose) and requires it for generated ("ready") exams.
 */
@Component({
  selector: 'app-exam-list',
  standalone: true,
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    TagComponent,
    ModalComponent,
    SelectComponent,
    InputComponent,
    PaginationComponent,
    LucideAngularModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './exam-list.component.html',
})
export class ExamListComponent {
  private readonly examsService = inject(ExamsService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly PAGE_SIZE = 50;
  protected readonly exams = signal<ExamListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly openMenuId = signal<string | null>(null);
  protected readonly pendingDelete = signal<ExamListItem | null>(null);
  protected readonly actionError = signal<string | null>(null);

  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly gradeLevelOptions: readonly SelectOption<string>[] = GRADE_LEVELS.map((gradeLevel) => ({
    value: gradeLevel,
    label: GRADE_LEVEL_LABELS[gradeLevel],
  }));

  protected readonly status = signal<ExamStatus | null>(null);
  protected readonly gradeLevel = signal<string | null>(null);
  protected readonly search = signal('');

  /**
   * True while any filter narrows the list. Drives WHICH empty state renders:
   * "aún no tienes exámenes" is only honest when nothing is filtered — with a
   * filter on it told a teacher with 6 exams that they had none (audit
   * 2026-08-15).
   */
  protected readonly hasActiveFilters = computed(
    () => this.status() !== null || this.gradeLevel() !== null || this.search().trim() !== '',
  );

  private searchDebounceHandle: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.load();
    this.destroyRef.onDestroy(() => {
      if (this.searchDebounceHandle !== null) {
        clearTimeout(this.searchDebounceHandle);
      }
    });
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.exams.set([]);
    this.examsService
      .listExams({
        status: this.status() ?? undefined,
        gradeLevel: this.gradeLevel() ?? undefined,
        search: this.search() || undefined,
        page: this.page(),
        pageSize: this.PAGE_SIZE,
      })
      .subscribe({
        next: (res) => {
          this.loading.set(false);
          this.exams.set([...res.items]);
          this.total.set(res.total);
        },
        error: (_e: HttpErrorResponse) => {
          this.loading.set(false);
          this.errorMessage.set('No se pudieron cargar los exámenes. Inténtalo de nuevo.');
        },
      });
  }
  protected retry(): void {
    this.load();
  }

  protected onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected onStatusChange(value: ExamStatus | null): void {
    this.status.set(value || null);
    this.page.set(1);
    this.load();
  }

  protected onGradeLevelChange(value: string | null): void {
    this.gradeLevel.set(value || null);
    this.page.set(1);
    this.load();
  }

  /** Debounces the título search box (spec §2.1) so it doesn't re-fetch on every keystroke. */
  /** "Quitar filtros" from the filtered empty state — one click back to the full list. */
  protected clearFilters(): void {
    if (this.searchDebounceHandle !== null) {
      clearTimeout(this.searchDebounceHandle);
      this.searchDebounceHandle = null;
    }
    this.status.set(null);
    this.gradeLevel.set(null);
    this.search.set('');
    this.page.set(1);
    this.load();
  }

  protected onSearchChange(value: string): void {
    this.search.set(value);
    this.page.set(1);
    if (this.searchDebounceHandle !== null) {
      clearTimeout(this.searchDebounceHandle);
    }
    this.searchDebounceHandle = setTimeout(() => {
      this.searchDebounceHandle = null;
      this.load();
    }, SEARCH_DEBOUNCE_MS);
  }

  protected statusTag(status: string): TagVariant {
    return status === 'ready' ? 'easy' : 'medium';
  }
  protected statusLabel(status: string): string {
    return status === 'ready' ? 'Generado' : 'Borrador';
  }
  protected gradeLabel(g: string): string {
    return GRADE_LEVEL_LABELS[g as GradeLevel] ?? g;
  }

  protected toggleMenu(id: string): void {
    this.openMenuId.update((cur) => (cur === id ? null : id));
  }

  protected open(exam: ExamListItem): void {
    this.router.navigate(['/app/exams', exam.id, 'versions']);
  }
  protected continueDraft(exam: ExamListItem): void {
    this.router.navigate(['/app/exams', exam.id]);
  }
  protected newExam(): void {
    this.router.navigate(['/app/exams/new']);
  }

  protected duplicate(exam: ExamListItem): void {
    this.openMenuId.set(null);
    this.actionError.set(null);
    this.examsService.duplicateExam(exam.id).subscribe({
      next: (copy) => this.router.navigate(['/app/exams', copy.id]),
      error: () => this.actionError.set('No se pudo duplicar el examen. Inténtalo de nuevo.'),
    });
  }

  protected requestDelete(exam: ExamListItem): void {
    this.openMenuId.set(null);
    if (exam.status === 'draft') {
      this.performDelete(exam);
      return;
    }
    this.pendingDelete.set(exam);
  }
  protected confirmDelete(): void {
    const exam = this.pendingDelete();
    if (exam) {
      this.performDelete(exam);
      this.pendingDelete.set(null);
    }
  }
  protected cancelDelete(): void {
    this.pendingDelete.set(null);
  }
  private performDelete(exam: ExamListItem): void {
    this.actionError.set(null);
    this.examsService.deleteExam(exam.id).subscribe({
      next: () => this.load(),
      error: () => this.actionError.set('No se pudo eliminar el examen. Inténtalo de nuevo.'),
    });
  }
}
