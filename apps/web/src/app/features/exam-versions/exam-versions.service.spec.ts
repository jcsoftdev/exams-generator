import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExamVersionsService } from './exam-versions.service';
import { environment } from '../../../environments/environment';
import { ExamVersion, GeneratedVersionResult } from './exam-versions.models';

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
      req.flush([]);
    });

    it('resolves with the generated version results returned by the API', () => {
      const versions: GeneratedVersionResult[] = [
        { code: 'A', pdfUrl: 'http://minio.test/a.pdf', answerSheetUrl: 'http://minio.test/a-key.pdf' },
        { code: 'B', pdfUrl: 'http://minio.test/b.pdf', answerSheetUrl: 'http://minio.test/b-key.pdf' },
      ];
      let result: GeneratedVersionResult[] | undefined;

      service.generateVersions('exam-1', 2).subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exams/exam-1/versions`);
      req.flush(versions);

      expect(result).toEqual(versions);
    });

    it('propagates the 422 error payload (message, examId, questionId) on failure', () => {
      let capturedError: unknown;

      service.generateVersions('exam-1', 1).subscribe({
        error: (error) => (capturedError = error),
      });

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exams/exam-1/versions`);
      req.flush(
        { message: 'Insufficient questions', examId: 'exam-1', questionId: 'question-9' },
        { status: 422, statusText: 'Unprocessable Entity' },
      );

      expect(capturedError).toBeTruthy();
      expect((capturedError as { error: { message: string } }).error.message).toBe(
        'Insufficient questions',
      );
      expect((capturedError as { error: { questionId: string } }).error.questionId).toBe(
        'question-9',
      );
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
