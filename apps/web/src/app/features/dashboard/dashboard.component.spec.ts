import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError, Subject } from 'rxjs';
import { provideRouter } from '@angular/router';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { DashboardComponent } from './dashboard.component';
import { DashboardService } from './dashboard.service';
import { DashboardStats } from './dashboard.models';
import { Difficulty } from '@exams-generator/shared';

const STATS: DashboardStats = {
  bank: {
    total: 12,
    byDifficulty: { [Difficulty.Easy]: 5, [Difficulty.Medium]: 4, [Difficulty.Hard]: 3 },
    byStatus: { draft: 2, approved: 9, archived: 1 },
  },
  exams: {
    total: 3,
    byStatus: { draft: 1, ready: 2 },
    recent: [
      {
        id: 'exam-1',
        title: 'Examen de Álgebra',
        status: 'ready',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
  },
  aiDrafts: { pending: 2 },
};

function setup(getStatsImpl: (...args: unknown[]) => unknown = () => of(STATS)) {
  const getStats = vi.fn(getStatsImpl);
  TestBed.configureTestingModule({
    imports: [DashboardComponent],
    providers: [
      { provide: DashboardService, useValue: { getStats } },
      provideRouter([]),
      provideCharts(withDefaultRegisterables()),
    ],
  });
  const fixture = TestBed.createComponent(DashboardComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement, getStats };
}

describe('DashboardComponent', () => {
  it('fetches stats on init and renders the bank/exams/ai cards', () => {
    const { compiled, getStats } = setup();

    expect(getStats).toHaveBeenCalledTimes(1);
    expect(compiled.querySelector('[data-testid="dashboard-card-bank"]')?.textContent).toContain(
      '12',
    );
    expect(compiled.querySelector('[data-testid="dashboard-card-exams"]')?.textContent).toContain(
      '3',
    );
    expect(compiled.querySelector('[data-testid="dashboard-card-ai"]')?.textContent).toContain('2');
  });

  it('renders the recent exams list with a status tag', () => {
    const { compiled } = setup();

    const row = compiled.querySelector('[data-testid="dashboard-recent-exam"]');
    expect(row?.textContent).toContain('Examen de Álgebra');
    // "Listo", not "Lista": the same word the exams screen uses for the same
    // state, and masculine to agree with `examen`.
    expect(row?.textContent).toContain('Listo');
  });

  it('shows an error message when the stats request fails', () => {
    const { compiled } = setup(() => throwError(() => new Error('network error')));

    expect(compiled.querySelector('[data-testid="dashboard-error"]')).toBeTruthy();
  });

  it('links the AI card to /app/ai/review', () => {
    const { compiled } = setup();

    const link = compiled.querySelector('[data-testid="dashboard-ai-link"]');
    expect(link?.getAttribute('href')).toBe('/app/ai/review');
  });

  describe('loading', () => {
    it('shows a loading indicator while the initial fetch is pending, then renders content once it resolves', () => {
      const subject = new Subject<DashboardStats>();
      const { compiled, fixture } = setup(() => subject.asObservable());

      expect(compiled.querySelector('[data-testid="dashboard-loading"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="dashboard-card-bank"]')).toBeFalsy();

      subject.next(STATS);
      subject.complete();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="dashboard-loading"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="dashboard-card-bank"]')?.textContent).toContain(
        '12',
      );
    });
  });
});
