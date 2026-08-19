import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData } from 'chart.js';
import { ChartDatum } from '../bar-chart/bar-chart.component';
import { ThemeService } from '../../core/theme/theme.service';

function themeColor(cssVar: string, fallbackHex: string): string {
  if (typeof document === 'undefined') {
    return fallbackHex;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  return value || fallbackHex;
}

/**
 * Thin `ng2-charts` wrapper (design doc §5), doughnut variant — same shape
 * as `BarChartComponent` (`ChartDatum` input, existing-token palette only).
 */
@Component({
  selector: 'ui-donut-chart',
  standalone: true,
  imports: [BaseChartDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas
      data-testid="donut-chart"
      baseChart
      [data]="chartData()"
      [options]="options"
      [type]="'doughnut'"
    ></canvas>
  `,
})
export class DonutChartComponent {
  private readonly themeService = inject(ThemeService);

  readonly data = input.required<readonly ChartDatum[]>();

  /**
   * Resolved at RENDER time, not module load (audit P0 #2) — see
   * `BarChartComponent.palette` for the full rationale.
   */
  protected readonly palette = computed<readonly string[]>(() => {
    this.themeService.mode();
    return [themeColor('--color-tint-active', '#deedfb'), themeColor('--color-n300', '#c3c8ce')];
  });

  protected readonly chartData = computed<ChartData<'doughnut'>>(() => {
    const palette = this.palette();
    return {
      labels: this.data().map((d) => d.label),
      datasets: [
        {
          data: this.data().map((d) => d.value),
          backgroundColor: this.data().map((_, i) => palette[i % palette.length]),
        },
      ],
    };
  });

  protected readonly options: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    plugins: { legend: { position: 'bottom' } },
  };
}
