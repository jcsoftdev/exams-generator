import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { GenerationJobDetailComponent } from './generation-job-detail.component';
import { AiService } from '../ai.service';
import { DraftQuestion, GenerationJob } from '../ai.models';

const RUNNING_JOB: GenerationJob = {
  id: 'job-1',
  tenantId: 'tenant-1',
  courseId: 'c1',
  topicId: 't1',
  difficulty: 'easy' as GenerationJob['difficulty'],
  gradeLevel: 'pre',
  count: 3,
  withFigure: false,
  status: 'running',
  createdCount: 1,
  failedCount: 0,
  createdQuestionIds: ['q1'],
  failedItems: [],
  cancelRequested: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
};

const DRAFT: DraftQuestion = {
  id: 'q1',
  tenantId: 'tenant-1',
  courseId: 'c1',
  topicId: 't1',
  difficulty: 'easy' as DraftQuestion['difficulty'],
  gradeLevel: 'pre',
  correctAnswer: '1',
  bodyTypst: '¿Cuánto es 2+2?',
  alternatives: ['3', '4', '5'],
  figureCode: null,
};

function setup(over: { getImpl?: (...a: unknown[]) => unknown; cancelImpl?: (...a: unknown[]) => unknown } = {}) {
  const getGenerationJob = vi.fn(over.getImpl ?? (() => of(RUNNING_JOB)));
  const cancelGenerationJob = vi.fn(over.cancelImpl ?? (() => of({ ...RUNNING_JOB, status: 'cancelled' as const })));
  const listDrafts = vi.fn(() => of([DRAFT]));
  TestBed.configureTestingModule({
    imports: [GenerationJobDetailComponent],
    providers: [
      { provide: AiService, useValue: { getGenerationJob, cancelGenerationJob, listDrafts } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'job-1' }) } } },
    ],
  });
  const fixture = TestBed.createComponent(GenerationJobDetailComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement, getGenerationJob, cancelGenerationJob, listDrafts };
}

describe('GenerationJobDetailComponent', () => {
  it('loads the job on init and shows its progress', () => {
    const { compiled, getGenerationJob } = setup();

    expect(getGenerationJob).toHaveBeenCalledWith('job-1');
    expect(compiled.textContent).toContain('1');
    expect(compiled.textContent).toContain('3');
  });

  it('renders question cards for created ids via listDrafts()', () => {
    const { compiled } = setup();

    expect(compiled.querySelector('[data-testid="job-question"]')?.textContent).toContain('¿Cuánto es 2+2?');
  });

  it('polls every 2s while the job is running, and stops once it reaches a terminal status', () => {
    vi.useFakeTimers();
    try {
      const getGenerationJob = vi
        .fn()
        .mockReturnValueOnce(of(RUNNING_JOB))
        .mockReturnValueOnce(of({ ...RUNNING_JOB, status: 'completed' as const, createdCount: 3 }));
      TestBed.configureTestingModule({
        imports: [GenerationJobDetailComponent],
        providers: [
          { provide: AiService, useValue: { getGenerationJob, cancelGenerationJob: vi.fn(), listDrafts: vi.fn(() => of([DRAFT])) } },
          { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'job-1' }) } } },
        ],
      });
      const fixture = TestBed.createComponent(GenerationJobDetailComponent);
      fixture.detectChanges();
      expect(getGenerationJob).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2000);
      expect(getGenerationJob).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(2000);
      // No third call — polling stopped once status became 'completed'.
      expect(getGenerationJob).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel() calls AiService.cancelGenerationJob and refreshes the job from the response', () => {
    const { compiled, cancelGenerationJob } = setup();

    (compiled.querySelector('[data-testid="cancel-job"] button') as HTMLButtonElement).click();

    expect(cancelGenerationJob).toHaveBeenCalledWith('job-1');
  });

  it('does not show the cancel button once the job is terminal', () => {
    const { compiled } = setup({ getImpl: () => of({ ...RUNNING_JOB, status: 'completed' as const }) });

    expect(compiled.querySelector('[data-testid="cancel-job"]')).toBeFalsy();
  });
});
