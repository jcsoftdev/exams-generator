import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpDownloadProgressEvent, HttpEventType, provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExamVersionsService } from './exam-versions.service';
import { environment } from '../../../environments/environment';
import { ExamVersion, ExamVersionJob } from './exam-versions.models';

const PENDING_JOB: ExamVersionJob = {
  id: 'job-1',
  examId: 'exam-1',
  versionCount: 3,
  status: 'pending',
  completedCount: 0,
  failedReason: null,
  failedQuestionId: null,
};

describe('ExamVersionsService', () => {
  let service: ExamVersionsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ExamVersionsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('generateVersions', () => {
    it('POSTs versionCount to /exams/:examId/versions', () => {
      service.generateVersions('exam-1', 3).subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exams/exam-1/versions`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ versionCount: 3 });
      req.flush(PENDING_JOB);
    });

    it('resolves with the queued job (202), not with the generated forms', () => {
      let result: ExamVersionJob | undefined;

      service.generateVersions('exam-1', 3).subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exams/exam-1/versions`);
      req.flush(PENDING_JOB);

      expect(result).toEqual(PENDING_JOB);
    });

    it('propagates a synchronous rejection (409 — exam not confirmed) — validation still happens before enqueue', () => {
      let capturedError: unknown;

      service.generateVersions('exam-1', 1).subscribe({
        error: (error) => (capturedError = error),
      });

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exams/exam-1/versions`);
      req.flush({ message: 'Exam has no selected questions' }, { status: 409, statusText: 'Conflict' });

      expect((capturedError as { status: number }).status).toBe(409);
    });
  });

  describe('latestVersionJob', () => {
    it('GETs .../versions/jobs/latest so a reloaded page can re-attach to a running generation', () => {
      let result: ExamVersionJob | null | undefined;

      service.latestVersionJob('exam-1').subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exams/exam-1/versions/jobs/latest`);
      expect(req.request.method).toBe('GET');
      req.flush(PENDING_JOB);

      expect(result).toEqual(PENDING_JOB);
    });
  });

  describe('streamVersionJob', () => {
    it('emits one job per SSE frame as the response text grows, and completes when the stream closes', () => {
      const emitted: ExamVersionJob[] = [];
      let completed = false;

      service
        .streamVersionJob('exam-1', 'job-1')
        .subscribe({ next: (job) => emitted.push(job), complete: () => (completed = true) });

      const req = httpMock.expectOne(
        `${environment.apiBaseUrl}/exams/exam-1/versions/jobs/job-1/stream`,
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('text');

      const running = { ...PENDING_JOB, status: 'running' as const, completedCount: 1 };
      const done = { ...PENDING_JOB, status: 'completed' as const, completedCount: 3 };
      req.event({
        type: HttpEventType.DownloadProgress,
        loaded: 1,
        partialText: `data: ${JSON.stringify(running)}\n\n`,
      } as HttpDownloadProgressEvent);
      req.flush(`data: ${JSON.stringify(running)}\n\ndata: ${JSON.stringify(done)}\n\n`);

      expect(emitted).toEqual([running, done]);
      expect(completed).toBe(true);
    });

    it('ignores a half-received frame until its terminating blank line arrives', () => {
      const emitted: ExamVersionJob[] = [];

      service.streamVersionJob('exam-1', 'job-1').subscribe((job) => emitted.push(job));

      const req = httpMock.expectOne(
        `${environment.apiBaseUrl}/exams/exam-1/versions/jobs/job-1/stream`,
      );
      req.event({
        type: HttpEventType.DownloadProgress,
        loaded: 1,
        partialText: `data: {"id":"job-1","comple`,
      } as HttpDownloadProgressEvent);

      expect(emitted).toEqual([]);
      req.flush('');
    });
  });

  describe('listVersions', () => {
    it('GETs /exams/:examId/versions (B4)', () => {
      service.listVersions('exam-1').subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exams/exam-1/versions`);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('resolves with the version list returned by the API (relative /assets/:id paths, DECISION B4-A)', () => {
      const versions: ExamVersion[] = [
        { code: 'A', pdfUrl: '/assets/pdf-a', answerSheetUrl: '/assets/answer-a' },
        { code: 'B', pdfUrl: '/assets/pdf-b', answerSheetUrl: '/assets/answer-b' },
      ];
      let result: ExamVersion[] | undefined;

      service.listVersions('exam-1').subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exams/exam-1/versions`);
      req.flush(versions);

      expect(result).toEqual(versions);
    });

    it('propagates a 404 when the exam does not exist or belongs to another tenant', () => {
      let capturedError: unknown;

      service.listVersions('missing-exam').subscribe({ error: (error) => (capturedError = error) });

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exams/missing-exam/versions`);
      req.flush({ message: 'Not Found' }, { status: 404, statusText: 'Not Found' });

      expect((capturedError as { status: number }).status).toBe(404);
    });
  });

  describe('downloadAsset', () => {
    it('GETs a relative asset path prefixed with apiBaseUrl, as a blob (mirrors BankService.fetchQuestionImage)', () => {
      let result: Blob | undefined;

      service.downloadAsset('/assets/pdf-a').subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/assets/pdf-a`);
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');

      const blob = new Blob(['fake-pdf-bytes'], { type: 'application/pdf' });
      req.flush(blob);

      expect(result).toEqual(blob);
    });
  });
});
