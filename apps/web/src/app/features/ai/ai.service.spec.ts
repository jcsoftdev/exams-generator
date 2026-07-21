import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpDownloadProgressEvent, HttpEventType, provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Difficulty } from '@exams-generator/shared';
import { AiService } from './ai.service';
import { environment } from '../../../environments/environment';
import {
  AiRevisedQuestion,
  DraftQuestion,
  GenerateQuestionsResult,
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

  describe('generateQuestions', () => {
    it('POSTs the generation payload to /ai/questions/generate', () => {
      service
        .generateQuestions({
          courseId: 'course-1',
          topicId: 'topic-1',
          difficulty: Difficulty.Hard,
          gradeLevel: 'secundaria_3',
          count: 5,
          withFigure: true,
        })
        .subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/generate`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        courseId: 'course-1',
        topicId: 'topic-1',
        difficulty: 'hard',
        gradeLevel: 'secundaria_3',
        count: 5,
        withFigure: true,
      });
      req.flush({ created: [], failed: [] });
    });

    it('resolves with the partial created/failed result returned by the API', () => {
      const apiResponse: GenerateQuestionsResult = {
        created: [{ id: 'q1' }, { id: 'q2' }],
        failed: [{ index: 2, error: 'invalid Typst markup' }],
      };
      let result: GenerateQuestionsResult | undefined;

      service
        .generateQuestions({
          courseId: 'course-1',
          topicId: 'topic-1',
          difficulty: Difficulty.Easy,
          gradeLevel: 'primaria_1',
          count: 3,
          withFigure: false,
        })
        .subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/generate`);
      req.flush(apiResponse);

      expect(result).toEqual(apiResponse);
    });
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
  });

  describe('listDrafts', () => {
    it('GETs /bank/questions with status=draft', () => {
      service.listDrafts().subscribe();

      const req = httpMock.expectOne(
        (request) => request.url === `${environment.apiBaseUrl}/bank/questions`,
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('status')).toBe('draft');
      req.flush([]);
    });

    it('resolves with the list of draft questions returned by the API', () => {
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
      let result: DraftQuestion[] | undefined;

      service.listDrafts().subscribe((response) => (result = response));

      const req = httpMock.expectOne(
        (request) => request.url === `${environment.apiBaseUrl}/bank/questions`,
      );
      req.flush(drafts);

      expect(result).toEqual(drafts);
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

      service
        .reviseQuestion('q1', 'más difícil')
        .subscribe((response) => (result = response));

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

      service
        .extractQuestionFromImage(image)
        .subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/ai/questions/extract`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toBeInstanceOf(FormData);

      const body = req.request.body as FormData;
      expect(body.get('file')).toBe(image);

      req.flush(extracted);

      expect(result).toEqual(extracted);
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

      const secondFrame = firstFrame + 'data: {"id":"job-1","status":"completed","createdCount":3}\n\n';
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
  });
});
