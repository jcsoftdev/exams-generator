import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Difficulty } from '@exams-generator/shared';
import { DashboardService } from './dashboard.service';
import { environment } from '../../../environments/environment';
import { DashboardStats } from './dashboard.models';

const STATS: DashboardStats = {
  bank: {
    total: 10,
    byDifficulty: { [Difficulty.Easy]: 4, [Difficulty.Medium]: 3, [Difficulty.Hard]: 3 },
    byStatus: { draft: 1, approved: 8, archived: 1 },
  },
  exams: {
    total: 2,
    byStatus: { draft: 1, ready: 1 },
    recent: [
      { id: 'exam-1', title: 'Examen 1', status: 'ready', createdAt: '2026-07-01T00:00:00.000Z' },
    ],
  },
  aiDrafts: { pending: 1 },
};

describe('DashboardService', () => {
  let service: DashboardService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DashboardService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('GETs /dashboard/stats and returns the parsed response', () => {
    let result: DashboardStats | undefined;
    service.getStats().subscribe((stats) => (result = stats));

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/dashboard/stats`);
    expect(req.request.method).toBe('GET');
    req.flush(STATS);

    expect(result).toEqual(STATS);
  });
});
