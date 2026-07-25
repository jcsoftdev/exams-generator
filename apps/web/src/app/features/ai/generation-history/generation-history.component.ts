import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LucideAngularModule, Sparkles } from 'lucide-angular';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { PaginationComponent } from '../../../ui/pagination/pagination.component';
import { TagVariant } from '../../../ui/ui.types';
import { AiService } from '../ai.service';
import { GenerationJob, GenerationJobListItem } from '../ai.models';

const STATUS_TAG: Record<GenerationJob['status'], TagVariant> = {
  pending: 'ai',
  running: 'ai',
  completed: 'easy',
  failed: 'hard',
  cancelled: 'medium',
};

const STATUS_LABEL: Record<GenerationJob['status'], string> = {
  pending: 'En cola',
  running: 'Generando',
  completed: 'Completado',
  failed: 'Falló',
  cancelled: 'Cancelado',
};

/**
 * "Historial IA" — lists every generation job for the tenant, running ones
 * first (design doc §6). Opening a row navigates to its live detail screen
 * (`GenerationJobDetailComponent`), same whether the job is still running
 * or long finished.
 */
@Component({
  selector: 'app-generation-history',
  standalone: true,
  imports: [EmptyStateComponent, TagComponent, PaginationComponent, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `ui-empty-state`'s `icon="sparkles"` renders a `<lucide-icon>` INSIDE
  // EmptyStateComponent's own template — that component only declares the
  // selector, it does NOT register any icon set (see its doc comment). The
  // caller (this component) must provide the icon data itself; root
  // `app.config.ts` already registers Sparkles for the real app, but this
  // component-level `.pick()` keeps the icon resolvable in isolated unit
  // tests too (same pattern as `exam-builder.component.ts`).
  providers: [LucideAngularModule.pick({ Sparkles }).providers ?? []],
  templateUrl: './generation-history.component.html',
})
export class GenerationHistoryComponent {
  private readonly aiService = inject(AiService);
  private readonly router = inject(Router);

  protected readonly PAGE_SIZE = 20;
  protected readonly jobs = signal<readonly GenerationJobListItem[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  constructor() {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.aiService.listGenerationJobs(this.page(), this.PAGE_SIZE).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.jobs.set(res.items);
        this.total.set(res.total);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set('No se pudo cargar el historial. Inténtalo de nuevo.');
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

  protected open(job: GenerationJob): void {
    this.router.navigate(['/app/ai/jobs', job.id]);
  }

  protected statusTag(status: GenerationJob['status']): TagVariant {
    return STATUS_TAG[status];
  }
  protected statusLabel(status: GenerationJob['status']): string {
    return STATUS_LABEL[status];
  }
}
