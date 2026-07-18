import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ConfirmExamResult,
  CreateExamPayload,
  CreateExamResult,
  ExamDetail,
  PreviewExamPayload,
  PreviewExamResult,
  ReplaceQuestionPayload,
  ReplaceQuestionResult,
  StockBatchPayload,
  StockBatchResult,
} from './exams.models';

/**
 * Angular client for the Fase 1 exams API (design doc §5.3): `POST /exams`
 * (blueprint -> automatic selection, 422 on stock shortage), `GET
 * /exams/:examId` (full detail — header + selected questions, tenant-scoped
 * 404 on mismatch), `POST /exams/:examId/questions/:questionId/replace`
 * (reroll/manual), and `POST /exams/:examId/confirm` (draft -> ready).
 * Bearer JWT is attached automatically by `authInterceptor` (see
 * app.config.ts) — same separation of concerns as `BankService`, this
 * service never touches auth headers.
 */
@Injectable({ providedIn: 'root' })
export class ExamsService {
  private readonly http = inject(HttpClient);

  createExam(payload: CreateExamPayload): Observable<CreateExamResult> {
    return this.http.post<CreateExamResult>(`${environment.apiBaseUrl}/exams`, payload);
  }

  getExam(examId: string): Observable<ExamDetail> {
    return this.http.get<ExamDetail>(`${environment.apiBaseUrl}/exams/${examId}`);
  }

  replaceQuestion(
    examId: string,
    questionId: string,
    payload: ReplaceQuestionPayload,
  ): Observable<ReplaceQuestionResult> {
    return this.http.post<ReplaceQuestionResult>(
      `${environment.apiBaseUrl}/exams/${examId}/questions/${questionId}/replace`,
      payload,
    );
  }

  confirmExam(examId: string): Observable<ConfirmExamResult> {
    return this.http.post<ConfirmExamResult>(`${environment.apiBaseUrl}/exams/${examId}/confirm`, {});
  }

  /** `POST /exams/stock/batch` (B1) — pure read, order-matched availability per cell. */
  stockBatch(payload: StockBatchPayload): Observable<StockBatchResult> {
    return this.http.post<StockBatchResult>(`${environment.apiBaseUrl}/exams/stock/batch`, payload);
  }

  /** `POST /exams/preview` (B2) — same body shape as `createExam` minus `title`; pure read, no persistence. */
  previewExam(payload: PreviewExamPayload): Observable<PreviewExamResult> {
    return this.http.post<PreviewExamResult>(`${environment.apiBaseUrl}/exams/preview`, payload);
  }
}
