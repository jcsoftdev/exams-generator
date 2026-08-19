import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, afterEach } from 'vitest';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { DonutChartComponent } from './donut-chart.component';
import { ChartDatum } from '../bar-chart/bar-chart.component';
import { ThemeService } from '../../core/theme/theme.service';

@Component({
  standalone: true,
  imports: [DonutChartComponent],
  template: `<ui-donut-chart [data]="data"></ui-donut-chart>`,
})
class HostComponent {
  data: ChartDatum[] = [
    { label: 'Borrador', value: 1 },
    { label: 'Lista', value: 2 },
  ];
}

function setup() {
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [provideCharts(withDefaultRegisterables())],
  });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

describe('DonutChartComponent', () => {
  it('renders a canvas without throwing when given data', () => {
    expect(() => setup()).not.toThrow();
  });

  it('renders exactly one canvas element', () => {
    const { compiled } = setup();
    expect(compiled.querySelectorAll('[data-testid="donut-chart"]').length).toBe(1);
  });

  it('builds one dataset value per input entry', () => {
    const { fixture } = setup();
    const donutChartDebugEl = fixture.debugElement.children[0];
    const instance = donutChartDebugEl.componentInstance as unknown as {
      chartData: () => { datasets: { data: number[] }[] };
    };

    expect(instance.chartData().datasets[0].data).toEqual([1, 2]);
  });

  // Reproduces audit P0 #2, donut variant: PALETTE used to be a module-level
  // `const` resolved once at chunk load, so toggling ThemeService.mode() (no
  // reload) never repainted the chart with the new theme's colors.
  it('re-resolves segment colors from the CSS tokens when the theme mode changes, without a reload', () => {
    const { fixture } = setup();
    const donutChartDebugEl = fixture.debugElement.children[0];
    const instance = donutChartDebugEl.componentInstance as unknown as {
      chartData: () => { datasets: { backgroundColor: string[] }[] };
    };

    // Simulate what the dark-mode CSS block does to --color-tint-active.
    document.documentElement.style.setProperty('--color-tint-active', '#123456');
    const themeService = TestBed.inject(ThemeService);
    themeService.toggle();
    fixture.detectChanges();

    expect(instance.chartData().datasets[0].backgroundColor[0]).toBe('#123456');
  });

  afterEach(() => {
    document.documentElement.style.removeProperty('--color-tint-active');
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem('theme');
  });
});
