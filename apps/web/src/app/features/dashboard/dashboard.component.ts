import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Difficulty } from '@exams-generator/shared';
import { CardComponent } from '../../ui/card/card.component';
import { BarChartComponent, ChartDatum } from '../../ui/bar-chart/bar-chart.component';
import { DonutChartComponent } from '../../ui/donut-chart/donut-chart.component';
import { DashboardService } from './dashboard.service';
import { DashboardStats } from './dashboard.models';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: 'Fácil',
  [Difficulty.Medium]: 'Media',
  [Difficulty.Hard]: 'Difícil',
};

const ERROR_MESSAGE = 'No se pudieron cargar las estadísticas. Inténtalo de nuevo.';

/**
 * Dashboard landing page (design doc §4): three `ui-card`s (bank/exams/AI
 * queue) fed by `DashboardService.getStats()`, fetched once in the
 * constructor — mirrors `BankListComponent`'s shape (inject service, load
 * eagerly, render via signals).
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CardComponent, BarChartComponent, DonutChartComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  private readonly dashboardService = inject(DashboardService);

  protected readonly stats = signal<DashboardStats | null>(null);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly bankChartData = computed<ChartDatum[]>(() => {
    const s = this.stats();
    if (!s) return [];
    return Object.values(Difficulty).map((d) => ({
      label: DIFFICULTY_LABELS[d],
      value: s.bank.byDifficulty[d] ?? 0,
    }));
  });

  protected readonly examChartData = computed<ChartDatum[]>(() => {
    const s = this.stats();
    if (!s) return [];
    return [
      { label: 'Borrador', value: s.exams.byStatus.draft ?? 0 },
      { label: 'Lista', value: s.exams.byStatus.ready ?? 0 },
    ];
  });

  constructor() {
    this.dashboardService.getStats().subscribe({
      next: (stats) => {
        this.stats.set(stats);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set(ERROR_MESSAGE);
      },
    });
  }

  protected examStatusLabel(status: 'draft' | 'ready'): string {
    return status === 'ready' ? 'Lista' : 'Borrador';
  }
}
