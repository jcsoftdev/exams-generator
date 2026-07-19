import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { DonutChartComponent } from './donut-chart.component';
import { ChartDatum } from '../bar-chart/bar-chart.component';

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
});
