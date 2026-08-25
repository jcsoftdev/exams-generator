import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpDownloadProgressEvent, HttpEventType, provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TimeoutError } from 'rxjs';
import { AiQuestionCrop, Difficulty, NormalizedBoxDto } from '@exams-generator/shared';
import { AiService } from './ai.service';
import { environment } from '../../../environments/environment';
import {
  AiRevisedQuestion,
  DraftListResult,
  DraftQuestion,
  GenerateQuestionStreamEvent,
  GenerationJob,
  GenerationJobChainResult,
  GenerationJobListResult,
} from './ai.models';

describe('AiService', () => {
  let service: AiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('generateQuestionStream', () => {
    const payload = {
      courseId: 'course-1',
      topicId: 'topic-1',
      difficulty: Difficulty.Medium,
      gradeLevel: 'secundaria_2',
      withFigure: false,
    };

    function downloadProgressEvent(partialText: string): HttpDownloadProgressEvent {
      return {
        type: HttpEventType.DownloadProgress,
        loaded: partialText.length,
        total: partialText.length,
        partialText,
      };
    }

    it('emits the parsed event for a single complete SSE frame delivered in one DownloadProgress tick', () => {
      const events: GenerateQuestionStreamEvent[] = [];
      service.generateQuestionStream(payload).subscribe((event) => events.push(event));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/generate/stream`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(payload);

      const partialText = 'data: {"type":"delta","text":"Hola"}\n\n';
      req.event(downloadProgressEvent(partialText));

      expect(events).toEqual([{ type: 'delta', text: 'Hola' }]);

      req.flush(partialText);
    });

    it('buffers an incomplete frame split across two DownloadProgress ticks and emits it only once it is complete', () => {
      const events: GenerateQuestionStreamEvent[] = [];
      service.generateQuestionStream(payload).subscribe((event) => events.push(event));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/generate/stream`);

      // partialText is CUMULATIVE — this first tick's text has no closing "\n\n" yet.
      const firstPartial = 'data: {"type":"delta","tex';
      req.event(downloadProgressEvent(firstPartial));
      expect(events).toEqual([]);

      // Second tick's partialText is the full cumulative text so far: the first
      // tick's text PLUS the rest of the frame PLUS the closing "\n\n".
      const fullText = `${firstPartial}t":"Hola"}\n\n`;
      req.event(downloadProgressEvent(fullText));

      expect(events).toEqual([{ type: 'delta', text: 'Hola' }]);

      req.flush(fullText);

      // Still just the one event — the terminal flush must not re-emit it.
      expect(events).toEqual([{ type: 'delta', text: 'Hola' }]);
    });

    it('emits multiple complete frames arriving in the same DownloadProgress tick, in order', () => {
      const events: GenerateQuestionStreamEvent[] = [];
      service.generateQuestionStream(payload).subscribe((event) => events.push(event));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/generate/stream`);

      const partialText =
        'data: {"type":"delta","text":"Hola"}\n\n' + 'data: {"type":"restart"}\n\n';
      req.event(downloadProgressEvent(partialText));

      expect(events).toEqual([{ type: 'delta', text: 'Hola' }, { type: 'restart' }]);

      req.flush(partialText);
    });

    it('flushes any remaining buffered text and completes the stream on the terminal Response event', () => {
      const events: GenerateQuestionStreamEvent[] = [];
      let completed = false;

      service.generateQuestionStream(payload).subscribe({
        next: (event) => events.push(event),
        complete: () => (completed = true),
      });

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/generate/stream`);

      // No DownloadProgress tick ever carried these final bytes — they only
      // ever show up in the terminal Response body.
      const fullResponseBodyText =
        'data: {"type":"done","result":{"created":[{"id":"q1"}],"failed":[]}}\n\n';
      req.flush(fullResponseBodyText);

      expect(events).toEqual([{ type: 'done', result: { created: [{ id: 'q1' }], failed: [] } }]);
      expect(completed).toBe(true);
    });

    /**
     * Audit finding P0: a SILENT drop (packets lost, no FIN/RST) fires
     * neither `next()` nor `error()` on the underlying HttpClient stream —
     * the caller would otherwise hang forever. `AI_STREAM_WATCHDOG_MS` is
     * derived from server behaviour (see the constant's own doc comment in
     * ai.service.ts): `MAX_COMPILE_ATTEMPTS` (2) × (OpenRouter's
     * SSE_TIMEOUT_MS idle-stall abort, 120s + Typst's TYPST_TIMEOUT_MS, 30s)
     * = 300s is the ceiling the SERVER itself enforces before it would have
     * thrown and closed the connection; this watchdog sits comfortably above
     * that so it can only fire on a connection that is truly silent.
     */
    it('errors with a TimeoutError (not silence) when no frame arrives within the watchdog window', () => {
      vi.useFakeTimers();
      try {
        let capturedError: unknown;
        service
          .generateQuestionStream(payload)
          .subscribe({ error: (err) => (capturedError = err) });

        httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/generate/stream`);

        vi.advanceTimersByTime(360_000);

        expect(capturedError).toBeInstanceOf(TimeoutError);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('listDraftsPaged', () => {
    it('GETs /bank/questions with status=draft&page=&pageSize=', () => {
      service.listDraftsPaged(2, 20).subscribe();

      const req = httpMock.expectOne(
        (request) => request.url === `${environment.apiBaseUrl}/bank/questions`,
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('status')).toBe('draft');
      expect(req.request.params.get('page')).toBe('2');
      expect(req.request.params.get('pageSize')).toBe('20');
      req.flush({ items: [], total: 0 });
    });

    it('resolves with the paginated envelope {items, total} — NOT the flat array `listDrafts()` used to return', () => {
      const drafts: DraftQuestion[] = [
        {
          id: 'q1',
          tenantId: 'tenant-1',
          courseId: 'course-1',
          topicId: 'topic-1',
          difficulty: Difficulty.Medium,
          gradeLevel: 'secundaria_2',
          correctAnswer: 'b',
          bodyTypst: '$1 + 1 = 2$',
          alternatives: ['a', 'b', 'c', 'd', 'e'],
          figureCode: null,
        },
      ];
      let result: DraftListResult | undefined;

      service.listDraftsPaged(1, 20).subscribe((response) => (result = response));

      const req = httpMock.expectOne(
        (request) => request.url === `${environment.apiBaseUrl}/bank/questions`,
      );
      // `items` deliberately has fewer rows than `total` — a page is not the
      // whole queue, same guarantee as `countDrafts()` below.
      req.flush({ items: drafts, total: 4231 });

      expect(result).toEqual({ items: drafts, total: 4231 });
    });
  });

  describe('getDraft', () => {
    it('GETs /bank/questions/:id and resolves with the single draft — the diff-by-id fetch `GenerationJobDetailComponent` uses instead of downloading the whole queue', () => {
      const draft: DraftQuestion = {
        id: 'q1',
        tenantId: 'tenant-1',
        courseId: 'course-1',
        topicId: 'topic-1',
        difficulty: Difficulty.Medium,
        gradeLevel: 'secundaria_2',
        correctAnswer: 'b',
        bodyTypst: '$1 + 1 = 2$',
        alternatives: ['a', 'b', 'c', 'd', 'e'],
        figureCode: null,
      };
      let result: DraftQuestion | undefined;

      service.getDraft('q1').subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/bank/questions/q1`);
      expect(req.request.method).toBe('GET');
      req.flush(draft);

      expect(result).toEqual(draft);
    });
  });

  describe('countDrafts', () => {
    it('GETs /bank/questions with status=draft&page=1&pageSize=1', () => {
      service.countDrafts().subscribe();

      const req = httpMock.expectOne(
        (request) => request.url === `${environment.apiBaseUrl}/bank/questions`,
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('status')).toBe('draft');
      expect(req.request.params.get('page')).toBe('1');
      expect(req.request.params.get('pageSize')).toBe('1');
      req.flush({ items: [], total: 0 });
    });

    it("resolves with the paginated envelope's total, not items.length", () => {
      let result: number | undefined;
      service.countDrafts().subscribe((total) => (result = total));

      const req = httpMock.expectOne(
        (request) => request.url === `${environment.apiBaseUrl}/bank/questions`,
      );
      // `items` deliberately has fewer rows than `total` — proves the
      // service reads `total`, not `items.length` (the whole point of the
      // fix: never download rows just to count them).
      req.flush({ items: [{ id: 'q1' }], total: 4231 });

      expect(result).toBe(4231);
    });
  });

  describe('approveQuestion', () => {
    it('POSTs to /bank/questions/:id/approve', () => {
      service.approveQuestion('q1').subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/bank/questions/q1/approve`);
      expect(req.request.method).toBe('POST');
      req.flush({ id: 'q1' });
    });
  });

  describe('rejectQuestion', () => {
    it('POSTs to /bank/questions/:id/reject', () => {
      service.rejectQuestion('q1').subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/bank/questions/q1/reject`);
      expect(req.request.method).toBe('POST');
      req.flush({ id: 'q1' });
    });
  });

  describe('previewDraft', () => {
    it('GETs /bank/questions/:id/preview as a blob', () => {
      service.previewDraft('q1').subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/bank/questions/q1/preview`);
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['%PDF'], { type: 'application/pdf' }));
    });
  });

  describe('editDraft', () => {
    it('PATCHes /bank/questions/:id with the given patch and resolves with the updated draft', () => {
      const updated: DraftQuestion = {
        id: 'q1',
        tenantId: null,
        courseId: 'course-1',
        topicId: 'topic-1',
        difficulty: Difficulty.Easy,
        gradeLevel: 'primaria_1',
        correctAnswer: 'c',
        bodyTypst: 'edited body',
        alternatives: ['a', 'b', 'c', 'd', 'e'],
        figureCode: null,
      };
      let result: DraftQuestion | undefined;

      service
        .editDraft('q1', { bodyTypst: 'edited body', correctAnswer: 'c' })
        .subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/bank/questions/q1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ bodyTypst: 'edited body', correctAnswer: 'c' });
      req.flush(updated);

      expect(result).toEqual(updated);
    });
  });

  describe('reviseQuestion', () => {
    it('POSTs /ai/questions/:id/revise with the instruction and resolves with the revised question', () => {
      const revised: AiRevisedQuestion = {
        bodyTypst: 'revised body',
        alternatives: ['a', 'b', 'c', 'd', 'e'],
        correctAnswer: '0',
      };
      let result: AiRevisedQuestion | undefined;

      service.reviseQuestion('q1', 'más difícil').subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/q1/revise`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ instruction: 'más difícil' });
      req.flush(revised);

      expect(result).toEqual(revised);
    });
  });

  describe('extractQuestionFromImage', () => {
    it('POSTs a multipart FormData with the image under "file" and resolves with the extracted question', () => {
      const image = new File(['fake-bytes'], 'question.png', { type: 'image/png' });
      const extracted: AiRevisedQuestion = {
        bodyTypst: 'extracted body',
        alternatives: ['a', 'b', 'c', 'd', 'e'],
        correctAnswer: '2',
      };
      let result: AiRevisedQuestion | undefined;

      service.extractQuestionFromImage(image).subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/extract`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toBeInstanceOf(FormData);

      const body = req.request.body as FormData;
      expect(body.get('file')).toBe(image);

      req.flush(extracted);

      expect(result).toEqual(extracted);
    });
  });

  describe('recropExtraction', () => {
    it('POSTs /ai/questions/extract/:extractionId/crop with { box } and resolves with the re-cut crop', () => {
      const box: NormalizedBoxDto = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
      const crop: AiQuestionCrop = { dataUrl: 'data:image/png;base64,AAA', box };
      let result: AiQuestionCrop | undefined;

      service.recropExtraction('extraction-1', box).subscribe((response) => (result = response));

      const req = httpMock.expectOne(
        `${environment.apiBaseUrl}/ai/questions/extract/extraction-1/crop`,
      );
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ box });
      req.flush(crop);

      expect(result).toEqual(crop);
    });
  });

  describe('createGenerationJob', () => {
    it('POSTs to /ai/questions/jobs and resolves with the created (pending) job', () => {
      const job: GenerationJob = {
        id: 'job-1',
        tenantId: 'tenant-1',
        courseId: 'course-1',
        topicId: 'topic-1',
        difficulty: Difficulty.Easy,
        gradeLevel: 'primaria_1',
        count: 5,
        withFigure: false,
        status: 'pending',
        createdCount: 0,
        failedCount: 0,
        createdQuestionIds: [],
        failedItems: [],
        cancelRequested: false,
        retriedFromJobId: null,
        rootJobId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
      };
      let result: GenerationJob | undefined;

      service
        .createGenerationJob({
          courseId: 'course-1',
          topicId: 'topic-1',
          difficulty: Difficulty.Easy,
          gradeLevel: 'primaria_1',
          count: 5,
          withFigure: false,
        })
        .subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/jobs`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        courseId: 'course-1',
        topicId: 'topic-1',
        difficulty: 'easy',
        gradeLevel: 'primaria_1',
        count: 5,
        withFigure: false,
      });
      req.flush(job);

      expect(result).toEqual(job);
    });
  });

  describe('listGenerationJobs', () => {
    it('GETs /ai/questions/jobs with page/pageSize params', () => {
      const result: GenerationJobListResult = { items: [], total: 0 };

      service.listGenerationJobs(2, 10).subscribe();

      const req = httpMock.expectOne(
        (request) => request.url === `${environment.apiBaseUrl}/ai/questions/jobs`,
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('page')).toBe('2');
      expect(req.request.params.get('pageSize')).toBe('10');
      req.flush(result);
    });
  });

  describe('getGenerationJob', () => {
    it('GETs /ai/questions/jobs/:id', () => {
      service.getGenerationJob('job-1').subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/jobs/job-1`);
      expect(req.request.method).toBe('GET');
      req.flush({});
    });
  });

  describe('cancelGenerationJob', () => {
    it('POSTs to /ai/questions/jobs/:id/cancel', () => {
      service.cancelGenerationJob('job-1').subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/jobs/job-1/cancel`);
      expect(req.request.method).toBe('POST');
      req.flush({});
    });
  });

  describe('getGenerationJobChain', () => {
    it('GETs /ai/questions/jobs/:id/chain', () => {
      let result: GenerationJobChainResult | undefined;

      service.getGenerationJobChain('job-1').subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/jobs/job-1/chain`);
      expect(req.request.method).toBe('GET');
      const chain: GenerationJobChainResult = { items: [] };
      req.flush(chain);

      expect(result).toEqual(chain);
    });
  });

  describe('streamGenerationJob', () => {
    function downloadProgressEvent(partialText: string): HttpDownloadProgressEvent {
      return {
        type: HttpEventType.DownloadProgress,
        loaded: partialText.length,
        total: partialText.length,
        partialText,
      };
    }

    it('GETs /ai/questions/jobs/:id/stream and emits each pushed job frame', () => {
      const jobs: GenerationJob[] = [];
      service.streamGenerationJob('job-1').subscribe((job) => jobs.push(job));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/jobs/job-1/stream`);
      expect(req.request.method).toBe('GET');

      const firstFrame = 'data: {"id":"job-1","status":"running","createdCount":1}\n\n';
      req.event(downloadProgressEvent(firstFrame));
      expect(jobs).toEqual([{ id: 'job-1', status: 'running', createdCount: 1 }]);

      const secondFrame =
        firstFrame + 'data: {"id":"job-1","status":"completed","createdCount":3}\n\n';
      req.event(downloadProgressEvent(secondFrame));
      expect(jobs).toEqual([
        { id: 'job-1', status: 'running', createdCount: 1 },
        { id: 'job-1', status: 'completed', createdCount: 3 },
      ]);

      req.flush(secondFrame);
    });

    it('completes the observable once the server closes the connection', () => {
      let completed = false;
      service.streamGenerationJob('job-1').subscribe({ complete: () => (completed = true) });

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/jobs/job-1/stream`);
      req.flush('data: {"id":"job-1","status":"completed","createdCount":3}\n\n');

      expect(completed).toBe(true);
    });

    it('errors with a TimeoutError when no frame arrives within the watchdog window (silent connection drop)', () => {
      vi.useFakeTimers();
      try {
        let capturedError: unknown;
        service.streamGenerationJob('job-1').subscribe({ error: (err) => (capturedError = err) });

        httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/jobs/job-1/stream`);

        vi.advanceTimersByTime(360_000);

        expect(capturedError).toBeInstanceOf(TimeoutError);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does NOT fire the watchdog while frames keep arriving before the window elapses (no false positive on a legitimately slow item)', () => {
      vi.useFakeTimers();
      try {
        let capturedError: unknown;
        const jobs: unknown[] = [];
        service.streamGenerationJob('job-1').subscribe({
          next: (job) => jobs.push(job),
          error: (err) => (capturedError = err),
        });

        const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/jobs/job-1/stream`);

        // Just under the window, then a fresh frame resets the clock.
        vi.advanceTimersByTime(359_999);
        req.event(
          downloadProgressEvent('data: {"id":"job-1","status":"running","createdCount":1}\n\n'),
        );
        expect(capturedError).toBeUndefined();

        vi.advanceTimersByTime(359_999);
        expect(capturedError).toBeUndefined();
        expect(jobs).toEqual([{ id: 'job-1', status: 'running', createdCount: 1 }]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
