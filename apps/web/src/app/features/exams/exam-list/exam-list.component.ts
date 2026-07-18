import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { ButtonComponent } from '../../../ui/button/button.component';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { ModalComponent } from '../../../ui/modal/modal.component';
import { TagVariant } from '../../../ui/ui.types';
import { ExamsService } from '../exams.service';
import { ExamListItem, GRADE_LEVEL_LABELS, GradeLevel } from '../exams.models';

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
  imports: [ButtonComponent, EmptyStateComponent, TagComponent, ModalComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './exam-list.component.html',
})
export class ExamListComponent {
  private readonly examsService = inject(ExamsService);
  private readonly router = inject(Router);

  protected readonly exams = signal<ExamListItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly openMenuId = signal<string | null>(null);
  protected readonly pendingDelete = signal<ExamListItem | null>(null);
  protected readonly actionError = signal<string | null>(null);

  constructor() {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.exams.set([]);
    this.examsService.listExams({ page: 1, pageSize: 50 }).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.exams.set([...res.items]);
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
