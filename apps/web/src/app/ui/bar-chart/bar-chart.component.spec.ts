import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { BarChartComponent, ChartDatum } from './bar-chart.component';

@Component({
  standalone: true,
  imports: [BarChartComponent],
  template: `<ui-bar-chart [data]="data"></ui-bar-chart>`,
})
class HostComponent {
  data: ChartDatum[] = [
    { label: 'Fácil', value: 5 },
    { label: 'Media', value: 3 },
    { label: 'Difícil', value: 2 },
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

describe('BarChartComponent', () => {
  it('renders a canvas without throwing when given data', () => {
    expect(() => setup()).not.toThrow();
  });

  it('renders exactly one canvas element', () => {
    const { compiled } = setup();
    expect(compiled.querySelectorAll('[data-testid="bar-chart"]').length).toBe(1);
  });

  it('builds one dataset value per input entry', () => {
    const { fixture } = setup();
    const barChartDebugEl = fixture.debugElement.children[0];
    const instance = barChartDebugEl.componentInstance as unknown as {
      chartData: () => { datasets: { data: number[] }[] };
    };

    expect(instance.chartData().datasets[0].data).toEqual([5, 3, 2]);
  });
});
