import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Difficulty } from '@exams-generator/shared';
import { BankService } from './bank.service';
import { environment } from '../../../environments/environment';
import { BankQuestion, BankTopicCount, PagedQuestions } from './bank.models';

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

    /**
     * B9 (audit L1): image-only questions had no title to show in the bank
     * list — the API already accepts an optional `sourceName` on this
     * endpoint, so send the picked file's own name for it.
     */
    it('sends the picked file name as sourceName, so image-only questions get a title in the bank list', () => {
      const image = new File(['fake-bytes'], 'foto-pregunta-3.png', { type: 'image/png' });

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
      const body = req.request.body as FormData;
      expect(body.get('sourceName')).toBe('foto-pregunta-3.png');

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

  describe('createStructuredQuestion', () => {
    it('POSTs /bank/questions/structured with the payload', () => {
      const payload = {
        courseId: 'c1',
        topicId: 't1',
        difficulty: Difficulty.Easy,
        gradeLevel: 'pre',
        correctAnswer: 'a',
        bodyTypst: '¿2+2?',
        alternatives: ['4', '3', '5', '6'],
      };

      service.createStructuredQuestion(payload).subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/bank/questions/structured`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(payload);
      req.flush({ id: 'new-q' });
    });
  });

  describe('buildImageAssetUrl', () => {
    it('builds a URL from the apiBaseUrl and the imageAssetId', () => {
      expect(service.buildImageAssetUrl('asset-1')).toBe(
        `${environment.apiBaseUrl}/assets/asset-1`,
      );
    });
  });

  describe('listQuestionsPaged', () => {
    it('hits /bank/questions with page params and returns {items,total}', () => {
      let result: PagedQuestions | undefined;

      service.listQuestionsPaged({ courseId: 'c1' }, 2, 20).subscribe((r) => (result = r));

      const req = httpMock.expectOne(
        (r) =>
          r.url === `${environment.apiBaseUrl}/bank/questions` &&
          r.params.get('page') === '2' &&
          r.params.get('pageSize') === '20' &&
          r.params.get('courseId') === 'c1',
      );
      expect(req.request.method).toBe('GET');
      req.flush({ items: [], total: 0 });

      expect(result).toEqual({ items: [], total: 0 });
    });
  });

  describe('getQuestionCounts', () => {
    it('GETs /bank/questions/summary with no query params when called without filters', () => {
      service.getQuestionCounts().subscribe();

      const req = httpMock.expectOne(
        (r) => r.url === `${environment.apiBaseUrl}/bank/questions/summary`,
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys().length).toBe(0);
      req.flush([]);
    });

    it('forwards the same filters the list endpoint takes, so counts match what expanding a topic returns', () => {
      let result: readonly BankTopicCount[] | undefined;
      const counts: BankTopicCount[] = [{ courseId: 'c1', topicId: 't1', total: 42 }];

      service
        .getQuestionCounts({ difficulty: Difficulty.Hard, gradeLevel: 'primaria_3' })
        .subscribe((r) => (result = r));

      const req = httpMock.expectOne(
        (r) => r.url === `${environment.apiBaseUrl}/bank/questions/summary`,
      );
      expect(req.request.params.get('difficulty')).toBe('hard');
      expect(req.request.params.get('gradeLevel')).toBe('primaria_3');
      req.flush(counts);

      expect(result).toEqual(counts);
    });
  });

  describe('archiveQuestion', () => {
    it('PATCHes /bank/questions/:id/archive', () => {
      service.archiveQuestion('q1').subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/bank/questions/q1/archive`);
      expect(req.request.method).toBe('PATCH');
      req.flush({ id: 'q1', status: 'archived' });
    });
  });

  describe('deleteQuestion', () => {
    it('DELETEs /bank/questions/:id', () => {
      service.deleteQuestion('q1').subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/bank/questions/q1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('getQuestion', () => {
    it('GETs /bank/questions/:id', () => {
      service.getQuestion('q1').subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/bank/questions/q1`);
      expect(req.request.method).toBe('GET');
      req.flush({
        id: 'q1',
        tenantId: 't1',
        courseId: 'c1',
        topicId: 'tp1',
        difficulty: 'easy',
        gradeLevel: 'pre',
        correctAnswer: 'a',
        imageAssetId: null,
      });
    });
  });

  describe('updateQuestion', () => {
    it('PATCHes /bank/questions/:id with the patch and resolves with the updated question', () => {
      const updated: BankQuestion = {
        id: 'q1',
        tenantId: null,
        courseId: 'course-1',
        topicId: 'topic-1',
        difficulty: Difficulty.Hard,
        gradeLevel: 'pre',
        correctAnswer: 'a',
        imageAssetId: null,
        status: 'approved',
        type: 'image',
        bodyTypst: null,
        alternatives: null,
        figureCode: null,
        sourceName: null,
        aiGenerated: false,
        usedInExamCount: 0,
      };
      let result: BankQuestion | undefined;

      service
        .updateQuestion('q1', { difficulty: Difficulty.Hard })
        .subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/bank/questions/q1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ difficulty: Difficulty.Hard });
      req.flush(updated);

      expect(result).toEqual(updated);
    });
  });

  describe('replaceQuestionImage', () => {
    it('POSTs a multipart FormData with the image under "file" and resolves with the id', () => {
      const image = new File(['fake-bytes'], 'question.png', { type: 'image/png' });
      let result: { id: string } | undefined;

      service.replaceQuestionImage('q1', image).subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/bank/questions/q1/image`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toBeInstanceOf(FormData);

      const body = req.request.body as FormData;
      expect(body.get('file')).toBe(image);

      req.flush({ id: 'q1' });

      expect(result).toEqual({ id: 'q1' });
    });
  });

  describe('fetchQuestionImage', () => {
    it('GETs /assets/:id as a blob (authInterceptor attaches the Bearer header; <img src> cannot)', () => {
      let result: Blob | undefined;

      service.fetchQuestionImage('asset-1').subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/assets/asset-1`);
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');

      const blob = new Blob(['fake-bytes'], { type: 'image/png' });
      req.flush(blob);

      expect(result).toEqual(blob);
    });
  });

  describe('setAlternativeImages', () => {
    it('pairs each image with its own alternative index by position, not just as two separate sets', () => {
      const fileA = new File(['a'], 'a.png', { type: 'image/png' });
      const fileC = new File(['c'], 'c.png', { type: 'image/png' });

      service
        .setAlternativeImages('q1', [
          { alternativeIndex: 0, file: fileA },
          { alternativeIndex: 2, file: fileC },
        ])
        .subscribe();

      const req = httpMock.expectOne(
        `${environment.apiBaseUrl}/bank/questions/q1/alternative-images`,
      );
      const body = req.request.body as FormData;
      const images = body.getAll('images');
      const indexes = body.getAll('indexes');

      // Identity (`toBe`), not shape — and pinned by position, so an
      // implementation that appends all images then all indexes (still
      // satisfying getAll('images').length===2 and getAll('indexes')===
      // ['0','2']) or that swaps which file sits at which slot cannot pass.
      expect(images.length).toBe(2);
      expect(images[0]).toBe(fileA);
      expect(indexes[0]).toBe('0');
      expect(images[1]).toBe(fileC);
      expect(indexes[1]).toBe('2');

      req.flush({ id: 'q1' });
    });
  });
});
