import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData } from 'chart.js';
import { ChartDatum } from '../bar-chart/bar-chart.component';

function themeColor(cssVar: string, fallbackHex: string): string {
  if (typeof document === 'undefined') {
    return fallbackHex;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  return value || fallbackHex;
}

const PALETTE = [themeColor('--color-tint-active', '#deedfb'), themeColor('--color-n300', '#c3c8ce')];

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
  readonly data = input.required<readonly ChartDatum[]>();

  protected readonly chartData = computed<ChartData<'doughnut'>>(() => ({
    labels: this.data().map((d) => d.label),
    datasets: [
      {
        data: this.data().map((d) => d.value),
        backgroundColor: this.data().map((_, i) => PALETTE[i % PALETTE.length]),
      },
    ],
  }));

  protected readonly options: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    plugins: { legend: { position: 'bottom' } },
  };
}
