import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData } from 'chart.js';
import { ThemeService } from '../../core/theme/theme.service';

export interface ChartDatum {
  readonly label: string;
  readonly value: number;
}

/**
 * Reads an existing `@theme` CSS custom property at runtime; falls back to
 * its known hex (copied from `styles.css`, used ONLY as a safety net for
 * environments with no loaded stylesheet, e.g. unit tests) — never
 * introduces a new color (DECISION: no new `@theme` tokens, design doc §5).
 */
function themeColor(cssVar: string, fallbackHex: string): string {
  if (typeof document === 'undefined') {
    return fallbackHex;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  return value || fallbackHex;
}

/**
 * Thin `ng2-charts` wrapper (design doc §5): one bar per `data()` entry,
 * colored from the SAME easy/medium/hard tokens `ui/tag` already uses — no
 * new palette. Requires `provideCharts(withDefaultRegisterables())` to be
 * registered (app-wide in `app.config.ts`; per-spec in tests).
 */
@Component({
  selector: 'ui-bar-chart',
  standalone: true,
  imports: [BaseChartDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas
      data-testid="bar-chart"
      baseChart
      [data]="chartData()"
      [options]="options"
      [type]="'bar'"
    ></canvas>
  `,
})
export class BarChartComponent {
  private readonly themeService = inject(ThemeService);

  readonly data = input.required<readonly ChartDatum[]>();

  /**
   * Resolved at RENDER time, not module load (audit P0 #2). Reads
   * `themeService.mode()` purely to establish a reactive dependency, so this
   * recomputes — and `chartData` below re-renders the chart — the instant
   * `ThemeService.toggle()` flips `data-theme`, no reload required.
   */
  protected readonly palette = computed<readonly string[]>(() => {
    this.themeService.mode();
    return [
      themeColor('--color-easy-bg', '#dcfce7'),
      themeColor('--color-medium-bg', '#fef3c7'),
      themeColor('--color-hard-bg', '#fee2e2'),
    ];
  });

  protected readonly chartData = computed<ChartData<'bar'>>(() => {
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

  protected readonly options: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    plugins: { legend: { display: false } },
  };
}
