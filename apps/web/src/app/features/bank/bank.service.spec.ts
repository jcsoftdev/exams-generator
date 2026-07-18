import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Difficulty } from '@exams-generator/shared';
import { BankService } from './bank.service';
import { environment } from '../../../environments/environment';
import { BankQuestion } from './bank.models';

describe('BankService', () => {
  let service: BankService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(BankService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('listQuestions', () => {
    it('GETs /bank/questions with no query params when called without filters', () => {
      service.listQuestions().subscribe();

      const req = httpMock.expectOne(
        (request) => request.url === `${environment.apiBaseUrl}/bank/questions`,
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys().length).toBe(0);
      req.flush([]);
    });

    it('forwards courseId/topicId/difficulty/gradeLevel as combinable query params', () => {
      service
        .listQuestions({
          courseId: 'course-1',
          topicId: 'topic-1',
          difficulty: Difficulty.Hard,
          gradeLevel: 'primaria_3',
        })
        .subscribe();

      const req = httpMock.expectOne(
        (request) => request.url === `${environment.apiBaseUrl}/bank/questions`,
      );
      expect(req.request.params.get('courseId')).toBe('course-1');
      expect(req.request.params.get('topicId')).toBe('topic-1');
      expect(req.request.params.get('difficulty')).toBe('hard');
      expect(req.request.params.get('gradeLevel')).toBe('primaria_3');
      req.flush([]);
    });

    it('resolves with the list of questions returned by the API', () => {
      const questions: BankQuestion[] = [
        {
          id: 'q1',
          tenantId: null,
          courseId: 'course-1',
          topicId: 'topic-1',
          difficulty: Difficulty.Easy,
          gradeLevel: 'primaria_1',
          correctAnswer: 'a',
          imageAssetId: 'asset-1',
        },
      ];
      let result: BankQuestion[] | undefined;

      service.listQuestions().subscribe((response) => (result = response));

      const req = httpMock.expectOne(
        (request) => request.url === `${environment.apiBaseUrl}/bank/questions`,
      );
      req.flush(questions);

      expect(result).toEqual(questions);
    });
  });

  describe('uploadImageQuestion', () => {
    it('POSTs a multipart FormData with all taxonomy fields plus the image file', () => {
      const image = new File(['fake-bytes'], 'question.png', { type: 'image/png' });

      service
        .uploadImageQuestion({
          courseId: 'course-1',
          topicId: 'topic-1',
          difficulty: Difficulty.Medium,
          gradeLevel: 'secundaria_2',
          correctAnswer: 'c',
          image,
        })
        .subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/bank/questions/image`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toBeInstanceOf(FormData);

      const body = req.request.body as FormData;
      expect(body.get('courseId')).toBe('course-1');
      expect(body.get('topicId')).toBe('topic-1');
      expect(body.get('difficulty')).toBe('medium');
      expect(body.get('gradeLevel')).toBe('secundaria_2');
      expect(body.get('correctAnswer')).toBe('c');
      expect(body.get('image')).toBe(image);

      req.flush({ id: 'new-question-id' });
    });

    it('resolves with the created question id', () => {
      const image = new File(['fake-bytes'], 'question.png', { type: 'image/png' });
      let result: { id: string } | undefined;

      service
        .uploadImageQuestion({
          courseId: 'course-1',
          topicId: 'topic-1',
          difficulty: Difficulty.Medium,
          gradeLevel: 'secundaria_2',
          correctAnswer: 'c',
          image,
        })
        .subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/bank/questions/image`);
      req.flush({ id: 'new-question-id' });

      expect(result).toEqual({ id: 'new-question-id' });
    });
  });

  describe('buildImageAssetUrl', () => {
    it('builds a URL from the apiBaseUrl and the imageAssetId', () => {
      expect(service.buildImageAssetUrl('asset-1')).toBe(`${environment.apiBaseUrl}/assets/asset-1`);
    });
  });
});
