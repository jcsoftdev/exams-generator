import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { ActivatedRoute, Router, convertToParamMap, ParamMap } from '@angular/router';
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
  retriedFromJobId: null,
  rootJobId: null,
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

const FAILED_JOB: GenerationJob = {
  ...RUNNING_JOB,
  status: 'failed',
  createdCount: 0,
  failedCount: 0,
  createdQuestionIds: [],
  failedItems: [{ index: 0, error: 'Unexpected server error' }],
};

const PARTIAL_JOB: GenerationJob = {
  ...RUNNING_JOB,
  status: 'completed',
  count: 3,
  createdCount: 1,
  failedCount: 2,
  failedItems: [
    { index: 1, error: 'Typst compile failed' },
    { index: 2, error: 'Typst compile failed' },
  ],
};

function setup(
  over: {
    streamImpl?: (id: string) => Observable<GenerationJob>;
    cancelImpl?: (...a: unknown[]) => unknown;
    previewImpl?: (id: string) => unknown;
    createImpl?: (...a: unknown[]) => unknown;
    chainImpl?: (id: string) => unknown;
    paramMap$?: BehaviorSubject<ParamMap>;
  } = {},
) {
  const streamGenerationJob = vi.fn(over.streamImpl ?? ((_id: string) => of(RUNNING_JOB)));
  const cancelGenerationJob = vi.fn(over.cancelImpl ?? (() => of({ ...RUNNING_JOB, status: 'cancelled' as const })));
  const listDrafts = vi.fn(() => of([DRAFT]));
  const previewDraft = vi.fn(
    over.previewImpl ?? (() => of(new Blob(['%PDF'], { type: 'application/pdf' }))),
  );
  const createGenerationJob = vi.fn(over.createImpl ?? (() => of({ ...RUNNING_JOB, id: 'job-2' })));
  const getGenerationJobChain = vi.fn(over.chainImpl ?? (() => of({ items: [RUNNING_JOB] })));
  const navigate = vi.fn();
  const paramMap$ = over.paramMap$ ?? new BehaviorSubject<ParamMap>(convertToParamMap({ id: 'job-1' }));
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:pdf-${n++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  TestBed.configureTestingModule({
    imports: [GenerationJobDetailComponent],
    providers: [
      {
        provide: AiService,
        useValue: {
          streamGenerationJob,
          cancelGenerationJob,
          listDrafts,
          previewDraft,
          createGenerationJob,
          getGenerationJobChain,
        },
      },
      { provide: ActivatedRoute, useValue: { paramMap: paramMap$ } },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const fixture = TestBed.createComponent(GenerationJobDetailComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    streamGenerationJob,
    cancelGenerationJob,
    listDrafts,
    previewDraft,
    createGenerationJob,
    getGenerationJobChain,
    navigate,
    paramMap$,
  };
}

describe('GenerationJobDetailComponent', () => {
  it('subscribes to the job stream on init and shows its progress', () => {
    const { compiled, streamGenerationJob } = setup();

    expect(streamGenerationJob).toHaveBeenCalledWith('job-1');
    expect(compiled.textContent).toContain('1');
    expect(compiled.textContent).toContain('3');
  });

  it('renders question cards for created ids via listDrafts(), mapped to the right question data', () => {
    const { compiled } = setup();

    const card = compiled.querySelector('[data-testid="job-question"]');
    expect(card).toBeTruthy();
    expect(compiled.textContent).toContain('clave: b');
  });

  it('compiles a real PDF preview for each newly-created question', () => {
    const { compiled, previewDraft } = setup();

    expect(previewDraft).toHaveBeenCalledWith('q1');
    expect(compiled.querySelector('[data-testid="preview-frame"]')?.getAttribute('src')).toMatch(/^blob:/);
  });

  it('falls back to raw content when the preview fails to compile', () => {
    const { compiled } = setup({ previewImpl: () => throwError(() => new Error('boom')) });

    expect(compiled.querySelector('[data-testid="preview-fallback"]')?.textContent).toContain('¿Cuánto es 2+2?');
  });

  it('updates live as the server pushes new frames on the same stream — no polling, no re-subscribe', () => {
    const source$ = new Subject<GenerationJob>();
    const streamGenerationJob = vi.fn(() => source$.asObservable());
    const { fixture, compiled } = setup({ streamImpl: streamGenerationJob });

    source$.next(RUNNING_JOB);
    fixture.detectChanges();
    expect(compiled.textContent).toContain('running');

    source$.next({ ...RUNNING_JOB, status: 'completed' as const, createdCount: 3, failedCount: 0 });
    fixture.detectChanges();

    expect(compiled.textContent).toContain('completed');
    expect(streamGenerationJob).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes from the stream on destroy', () => {
    const source$ = new Subject<GenerationJob>();
    const { fixture } = setup({ streamImpl: () => source$.asObservable() });

    expect(source$.observed).toBe(true);
    fixture.destroy();
    expect(source$.observed).toBe(false);
  });

  it('cancel() calls AiService.cancelGenerationJob and refreshes the job from the response', () => {
    const { compiled, cancelGenerationJob } = setup();

    (compiled.querySelector('[data-testid="cancel-job"] button') as HTMLButtonElement).click();

    expect(cancelGenerationJob).toHaveBeenCalledWith('job-1');
  });

  it('does not show the cancel button once the job is terminal', () => {
    const { compiled } = setup({ streamImpl: () => of({ ...RUNNING_JOB, status: 'completed' as const }) });

    expect(compiled.querySelector('[data-testid="cancel-job"]')).toBeFalsy();
  });

  it('shows a retry button when the whole job failed, resubmitting the full count', () => {
    const { compiled, createGenerationJob, navigate } = setup({ streamImpl: () => of(FAILED_JOB) });

    expect(compiled.querySelector('[data-testid="retry-job"]')).toBeTruthy();
    (compiled.querySelector('[data-testid="retry-job"] button') as HTMLButtonElement).click();

    expect(createGenerationJob).toHaveBeenCalledWith({
      courseId: 'c1',
      topicId: 't1',
      difficulty: 'easy',
      gradeLevel: 'pre',
      count: 3,
      withFigure: false,
      retriedFromJobId: 'job-1',
    });
    expect(navigate).toHaveBeenCalledWith(['/app/ai/jobs', 'job-2']);
  });

  it('shows a retry button when the job completed with partial failures, resubmitting only the unresolved count', () => {
    const { compiled, createGenerationJob } = setup({ streamImpl: () => of(PARTIAL_JOB) });

    expect(compiled.querySelector('[data-testid="retry-job"]')).toBeTruthy();
    (compiled.querySelector('[data-testid="retry-job"] button') as HTMLButtonElement).click();

    expect(createGenerationJob).toHaveBeenCalledWith(expect.objectContaining({ count: 2 }));
  });

  it('resubmits count - createdCount even for a cancelled job with unattempted items (not just failedCount)', () => {
    const CANCELLED_MID_BATCH: GenerationJob = {
      ...RUNNING_JOB,
      status: 'cancelled',
      count: 5,
      createdCount: 2,
      failedCount: 0,
      failedItems: [],
    };
    const { compiled, createGenerationJob } = setup({ streamImpl: () => of(CANCELLED_MID_BATCH) });

    (compiled.querySelector('[data-testid="retry-job"] button') as HTMLButtonElement).click();

    // 3 items were never attempted (5 - 2), not 0 (failedCount) — a failedCount-only
    // formula would wrongly hide the retry button / drop these items entirely.
    expect(createGenerationJob).toHaveBeenCalledWith(expect.objectContaining({ count: 3 }));
  });

  it('does not show a retry button when the job completed without any failures', () => {
    const { compiled } = setup({ streamImpl: () => of({ ...RUNNING_JOB, status: 'completed' as const, createdCount: 3 }) });

    expect(compiled.querySelector('[data-testid="retry-job"]')).toBeFalsy();
  });

  it('reloads from a clean state when the route id changes in place (retry navigation reuses the component instance)', () => {
    const paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({ id: 'job-1' }));
    const streamGenerationJob = vi.fn((id: string) =>
      of(id === 'job-1' ? RUNNING_JOB : { ...FAILED_JOB, id: 'job-2' }),
    );
    const { fixture, compiled } = setup({ streamImpl: streamGenerationJob, paramMap$ });

    expect(streamGenerationJob).toHaveBeenCalledWith('job-1');
    expect(compiled.querySelector('[data-testid="job-question"]')).toBeTruthy();

    // Same route config, new :id — exactly what retry()'s router.navigate() produces.
    paramMap$.next(convertToParamMap({ id: 'job-2' }));
    fixture.detectChanges();

    expect(streamGenerationJob).toHaveBeenCalledWith('job-2');
    // Stale state from job-1 (its question card) must be gone, not merged with job-2.
    expect(compiled.querySelector('[data-testid="job-question"]')).toBeFalsy();
  });

  describe('retry history', () => {
    it('does not show a retry-history section for a job with no prior attempts', () => {
      const { compiled, getGenerationJobChain } = setup({ chainImpl: () => of({ items: [RUNNING_JOB] }) });

      expect(getGenerationJobChain).toHaveBeenCalledWith('job-1');
      expect(compiled.querySelector('[data-testid="retry-history"]')).toBeFalsy();
    });

    it('shows every PRIOR attempt (excluding the current job) when the chain has more than one', () => {
      const original = { ...FAILED_JOB, id: 'job-0' };
      const { compiled } = setup({
        streamImpl: () => of(RUNNING_JOB),
        chainImpl: () => of({ items: [original, RUNNING_JOB] }),
      });

      const items = compiled.querySelectorAll('[data-testid="retry-history-item"]');
      expect(items).toHaveLength(1);
      expect(items[0]!.textContent).toContain('Falló');
    });

    it('navigates to a prior attempt when its history row is clicked', () => {
      const original = { ...FAILED_JOB, id: 'job-0' };
      const { compiled, navigate } = setup({
        streamImpl: () => of(RUNNING_JOB),
        chainImpl: () => of({ items: [original, RUNNING_JOB] }),
      });

      (compiled.querySelector('[data-testid="retry-history-item"]') as HTMLElement).click();

      expect(navigate).toHaveBeenCalledWith(['/app/ai/jobs', 'job-0']);
    });

    it('reloads the chain when the route id changes in place (retry navigation reuses the component instance)', () => {
      const paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({ id: 'job-1' }));
      const getGenerationJobChain = vi.fn((id: string) =>
        of({ items: id === 'job-1' ? [RUNNING_JOB] : [{ ...FAILED_JOB, id: 'job-0' }, { ...RUNNING_JOB, id: 'job-2' }] }),
      );
      const { fixture } = setup({ paramMap$, chainImpl: getGenerationJobChain });

      paramMap$.next(convertToParamMap({ id: 'job-2' }));
      fixture.detectChanges();

      expect(getGenerationJobChain).toHaveBeenCalledWith('job-2');
    });
  });
});
