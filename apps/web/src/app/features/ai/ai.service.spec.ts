import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Difficulty } from '@exams-generator/shared';
import { AiService } from './ai.service';
import { environment } from '../../../environments/environment';
import { AiRevisedQuestion, DraftQuestion, GenerateQuestionsResult } from './ai.models';

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
});
