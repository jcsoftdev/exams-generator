import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';
import { Router } from '@angular/router';
import { GenerationHistoryComponent } from './generation-history.component';
import { AiService } from '../ai.service';
import { GenerationJob, GenerationJobListResult } from '../ai.models';

function job(overrides: Partial<GenerationJob>): GenerationJob {
  return {
    id: 'job-1',
    tenantId: 'tenant-1',
    courseId: 'c1',
    topicId: 't1',
    difficulty: 'easy' as GenerationJob['difficulty'],
    gradeLevel: 'pre',
    count: 5,
    withFigure: false,
    status: 'completed',
    createdCount: 5,
    failedCount: 0,
    createdQuestionIds: [],
    failedItems: [],
    cancelRequested: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:05:00.000Z',
    ...overrides,
  };
}

function setup(result: GenerationJobListResult = { items: [], total: 0 }) {
  const listGenerationJobs = vi.fn(() => of(result));
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    imports: [GenerationHistoryComponent],
    providers: [
      { provide: AiService, useValue: { listGenerationJobs } },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const fixture = TestBed.createComponent(GenerationHistoryComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement, listGenerationJobs, navigate };
}

describe('GenerationHistoryComponent', () => {
  it('loads jobs for the tenant on init', () => {
    const { listGenerationJobs } = setup();

    expect(listGenerationJobs).toHaveBeenCalled();
  });

  it('renders one row per job with a status label', () => {
    const { compiled } = setup({
      items: [job({ id: 'job-1', status: 'running' }), job({ id: 'job-2', status: 'completed' })],
      total: 2,
    });

    const rows = compiled.querySelectorAll('[data-testid="job-row"]');
    expect(rows).toHaveLength(2);
  });

  it('shows an empty state when there are no jobs', () => {
    const { compiled } = setup();

    expect(compiled.querySelector('[data-testid="history-empty"]')).toBeTruthy();
  });

  it('navigates to the job detail screen when a row is clicked', () => {
    const { compiled, navigate } = setup({ items: [job({ id: 'job-1' })], total: 1 });

    (compiled.querySelector('[data-testid="job-row"]') as HTMLElement).click();

    expect(navigate).toHaveBeenCalledWith(['/app/ai/jobs', 'job-1']);
  });
});
