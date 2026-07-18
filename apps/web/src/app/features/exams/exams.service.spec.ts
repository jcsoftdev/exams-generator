import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Difficulty } from '@exams-generator/shared';
import { ExamsService } from './exams.service';
import { environment } from '../../../environments/environment';
import { ConfirmExamResult, CreateExamResult, ExamDetail, ReplaceQuestionResult } from './exams.models';

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
            topicId: 't1',
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
});
