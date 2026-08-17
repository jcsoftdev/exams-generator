import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Difficulty } from '@exams-generator/shared';
import { ExamsService } from './exams.service';
import { environment } from '../../../environments/environment';
import {
  ConfirmExamResult,
  CreateExamResult,
  ExamDetail,
  ExamType,
  PreviewExamResult,
  ReplaceQuestionResult,
  ResolveBlueprintResult,
  StockBatchResult,
  Track,
  University,
} from './exams.models';

describe('ExamsService', () => {
  let service: ExamsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ExamsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('createExam', () => {
    it('POSTs the blueprint payload to /exams', () => {
      service
        .createExam({
          title: 'Admisión 2026',
          gradeLevel: 'secundaria_5',
          blueprint: [{ courseId: 'course-1', topicId: 'topic-1', difficulty: Difficulty.Easy, count: 5 }],
        })
        .subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exams`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        title: 'Admisión 2026',
        gradeLevel: 'secundaria_5',
        blueprint: [{ courseId: 'course-1', topicId: 'topic-1', difficulty: Difficulty.Easy, count: 5 }],
      });
      req.flush({ id: 'exam-1', status: 'draft', selectedQuestionIds: ['q1'] });
    });

    it('resolves with the created exam and its selected question ids', () => {
      const result: CreateExamResult = { id: 'exam-1', status: 'draft', selectedQuestionIds: ['q1', 'q2'] };
      let response: CreateExamResult | undefined;

      service
        .createExam({ title: 'T', gradeLevel: 'pre', blueprint: [{ courseId: 'c1', count: 2 }] })
        .subscribe((r: CreateExamResult) => (response = r));

      httpMock.expectOne(`${environment.apiBaseUrl}/exams`).flush(result);

      expect(response).toEqual(result);
    });
  });

  describe('replaceQuestion', () => {
    it('POSTs {mode: "reroll"} to the replace endpoint', () => {
      service.replaceQuestion('exam-1', 'q1', { mode: 'reroll' }).subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exams/exam-1/questions/q1/replace`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ mode: 'reroll' });
      req.flush({ examId: 'exam-1', oldQuestionId: 'q1', newQuestionId: 'q2' });
    });

    it('POSTs {mode: "manual", replacementQuestionId} to the replace endpoint', () => {
      service.replaceQuestion('exam-1', 'q1', { mode: 'manual', replacementQuestionId: 'q9' }).subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exams/exam-1/questions/q1/replace`);
      expect(req.request.body).toEqual({ mode: 'manual', replacementQuestionId: 'q9' });
      req.flush({ examId: 'exam-1', oldQuestionId: 'q1', newQuestionId: 'q9' });
    });

    it('resolves with the replacement result', () => {
      const result: ReplaceQuestionResult = { examId: 'exam-1', oldQuestionId: 'q1', newQuestionId: 'q2' };
      let response: ReplaceQuestionResult | undefined;

      service
        .replaceQuestion('exam-1', 'q1', { mode: 'reroll' })
        .subscribe((r: ReplaceQuestionResult) => (response = r));

      httpMock.expectOne(`${environment.apiBaseUrl}/exams/exam-1/questions/q1/replace`).flush(result);

      expect(response).toEqual(result);
    });
  });

  describe('confirmExam', () => {
    it('POSTs to /exams/:examId/confirm', () => {
      service.confirmExam('exam-1').subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exams/exam-1/confirm`);
      expect(req.request.method).toBe('POST');
      req.flush({ id: 'exam-1', status: 'ready' });
    });

    it('resolves with the confirmed exam status', () => {
      const result: ConfirmExamResult = { id: 'exam-1', status: 'ready' };
      let response: ConfirmExamResult | undefined;

      service.confirmExam('exam-1').subscribe((r: ConfirmExamResult) => (response = r));

      httpMock.expectOne(`${environment.apiBaseUrl}/exams/exam-1/confirm`).flush(result);

      expect(response).toEqual(result);
    });
  });

  describe('getExam', () => {
    it('GETs /exams/:examId', () => {
      service.getExam('exam-1').subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exams/exam-1`);
      expect(req.request.method).toBe('GET');
      req.flush({ id: 'exam-1', title: 'T', gradeLevel: 'pre', status: 'draft', questions: [] });
    });

    it('resolves with the exam detail (header + selected questions)', () => {
      const detail: ExamDetail = {
        id: 'exam-1',
        title: 'Admisión 2026',
        gradeLevel: 'secundaria_5',
        status: 'draft',
        questions: [
          {
            id: 'q1',
            position: 0,
            type: 'image',
            courseId: 'c1',
            courseName: 'Aritmética',
            topicId: 't1',
            topicName: 'Conjuntos',
            difficulty: Difficulty.Easy,
            correctAnswer: 'a',
            imageAssetId: 'asset-1',
            bodyTypst: null,
            alternatives: null,
            figureCode: null,
          },
        ],
      };
      let response: ExamDetail | undefined;

      service.getExam('exam-1').subscribe((r: ExamDetail) => (response = r));

      httpMock.expectOne(`${environment.apiBaseUrl}/exams/exam-1`).flush(detail);

      expect(response).toEqual(detail);
    });
  });

  describe('stockBatch', () => {
    it('POSTs {gradeLevel, cells} to /exams/stock/batch (B1)', () => {
      service
        .stockBatch({
          gradeLevel: 'secundaria_1',
          cells: [{ courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy }],
        })
        .subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exams/stock/batch`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        gradeLevel: 'secundaria_1',
        cells: [{ courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy }],
      });
      req.flush({ results: [{ courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 18 }] });
    });

    it('resolves with the order-matched availability results', () => {
      const result: StockBatchResult = {
        results: [{ courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, available: 18 }],
      };
      let response: StockBatchResult | undefined;

      service
        .stockBatch({ gradeLevel: 'secundaria_1', cells: [{ courseId: 'c1' }] })
        .subscribe((r: StockBatchResult) => (response = r));

      httpMock.expectOne(`${environment.apiBaseUrl}/exams/stock/batch`).flush(result);

      expect(response).toEqual(result);
    });
  });

  describe('previewExam', () => {
    it('POSTs {gradeLevel, blueprint} to /exams/preview (B2)', () => {
      service
        .previewExam({
          gradeLevel: 'secundaria_1',
          blueprint: [{ courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, count: 6 }],
        })
        .subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exams/preview`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        gradeLevel: 'secundaria_1',
        blueprint: [{ courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, count: 6 }],
      });
      req.flush({
        selections: [
          { rowIndex: 0, courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, questionIds: ['q1', 'q2'] },
        ],
        shortages: [],
      });
    });

    it('resolves with selections + shortages (no exact-id assertion — selection is random per B2-R5)', () => {
      const result: PreviewExamResult = {
        selections: [
          { rowIndex: 0, courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, questionIds: ['q1'] },
        ],
        shortages: [{ rowIndex: 1, courseId: 'c2', requested: 10, available: 4 }],
      };
      let response: PreviewExamResult | undefined;

      service
        .previewExam({
          gradeLevel: 'secundaria_1',
          blueprint: [
            { courseId: 'c1', topicId: 't1', difficulty: Difficulty.Easy, count: 1 },
            { courseId: 'c2', count: 10 },
          ],
        })
        .subscribe((r: PreviewExamResult) => (response = r));

      httpMock.expectOne(`${environment.apiBaseUrl}/exams/preview`).flush(result);

      expect(response).toEqual(result);
    });
  });

  describe('listExams', () => {
    it('GETs /exams with filter params and returns {items,total}', () => {
      service.listExams({ status: 'ready', page: 1, pageSize: 20 }).subscribe();
      const req = httpMock.expectOne(
        (r) =>
          r.url === '/api/exams' &&
          r.params.get('status') === 'ready' &&
          r.params.get('page') === '1' &&
          r.params.get('pageSize') === '20',
      );
      expect(req.request.method).toBe('GET');
      req.flush({ items: [], total: 0 });
    });
  });

  describe('duplicateExam', () => {
    it('POSTs /exams/:id/duplicate', () => {
      service.duplicateExam('e1').subscribe();
      const req = httpMock.expectOne('/api/exams/e1/duplicate');
      expect(req.request.method).toBe('POST');
      req.flush({ id: 'e2', title: 'Copia de X', status: 'draft' });
    });
  });

  describe('deleteExam', () => {
    it('DELETEs /exams/:id', () => {
      service.deleteExam('e1').subscribe();
      const req = httpMock.expectOne('/api/exams/e1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('getUniversities', () => {
    it('GETs /universities and resolves the catalog', () => {
      const result: University[] = [{ id: 'u1', code: 'uni', name: 'UNI' }];
      let response: University[] | undefined;

      service.getUniversities().subscribe((r: University[]) => (response = r));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/universities`);
      expect(req.request.method).toBe('GET');
      req.flush(result);

      expect(response).toEqual(result);
    });
  });

  describe('getUniversityTracks', () => {
    it('GETs /universities/:universityId/tracks', () => {
      const result: Track[] = [{ id: 't1', code: 'I', name: 'Salud', kind: 'area' }];
      let response: Track[] | undefined;

      service.getUniversityTracks('u1').subscribe((r: Track[]) => (response = r));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/universities/u1/tracks`);
      expect(req.request.method).toBe('GET');
      req.flush(result);

      expect(response).toEqual(result);
    });

    it('resolves an empty array for a university with no track concept, without treating it as an error', () => {
      let response: Track[] | undefined;

      service.getUniversityTracks('u2').subscribe((r: Track[]) => (response = r));

      httpMock.expectOne(`${environment.apiBaseUrl}/universities/u2/tracks`).flush([]);

      expect(response).toEqual([]);
    });
  });

  describe('getExamTypes', () => {
    it('GETs /exam-types and resolves the catalog', () => {
      const result: ExamType[] = [
        { code: 'manual', label: 'Manual', courseScope: 'none', weekScope: 'none' },
        { code: 'fastest', label: 'Fastest', courseScope: 'selected', weekScope: 'current_only' },
      ];
      let response: ExamType[] | undefined;

      service.getExamTypes().subscribe((r: ExamType[]) => (response = r));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exam-types`);
      expect(req.request.method).toBe('GET');
      req.flush(result);

      expect(response).toEqual(result);
    });
  });

  describe('resolveBlueprint', () => {
    it('POSTs {examTypeCode, universityId, trackId?, selectedCourseIds?} to /exams/blueprint/resolve', () => {
      service
        .resolveBlueprint({
          examTypeCode: 'fastest',
          universityId: 'u1',
          trackId: 'trk1',
          selectedCourseIds: ['c1', 'c2'],
        })
        .subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/exams/blueprint/resolve`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        examTypeCode: 'fastest',
        universityId: 'u1',
        trackId: 'trk1',
        selectedCourseIds: ['c1', 'c2'],
      });
      req.flush({ blueprint: [], weekNumber: null, templateId: null });
    });

    it('resolves with the blueprint rows, weekNumber, and templateId', () => {
      const result: ResolveBlueprintResult = {
        blueprint: [{ courseId: 'c1', topicId: 't1', count: 5, difficulty: Difficulty.Easy }],
        weekNumber: 3,
        templateId: 'tpl-1',
      };
      let response: ResolveBlueprintResult | undefined;

      service
        .resolveBlueprint({ examTypeCode: 'eta_by_week', universityId: 'u1' })
        .subscribe((r: ResolveBlueprintResult) => (response = r));

      httpMock.expectOne(`${environment.apiBaseUrl}/exams/blueprint/resolve`).flush(result);

      expect(response).toEqual(result);
    });
  });
});
