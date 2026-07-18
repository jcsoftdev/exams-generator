import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ConfirmExamResult,
  CreateExamPayload,
  CreateExamResult,
  ExamQuestionSummary,
  ReplaceQuestionPayload,
  ReplaceQuestionResult,
} from './exams.models';

/**
 * Angular client for the Fase 1 exams API (design doc §5.3): `POST /exams`
 * (blueprint -> automatic selection, 422 on stock shortage),
 * `POST /exams/:examId/questions/:questionId/replace` (reroll/manual), and
 * `POST /exams/:examId/confirm` (draft -> ready). Bearer JWT is attached
 * automatically by `authInterceptor` (see app.config.ts) — same separation
 * of concerns as `BankService`, this service never touches auth headers.
 *
 * GAP: there is no `GET /exams/:examId` endpoint yet, so a created exam's
 * review state only lives in the browser (see `ExamCreateComponent`) —
 * refreshing the page loses it. `getQuestionById` reuses the bank module's
 * `GET /bank/questions/:id` purely to render course/topic/answer for the
 * bare ids `POST /exams` returns; there is no dedicated
 * exam-question-detail endpoint.
 */
@Injectable({ providedIn: 'root' })
export class ExamsService {
  private readonly http = inject(HttpClient);

  createExam(payload: CreateExamPayload): Observable<CreateExamResult> {
    return this.http.post<CreateExamResult>(`${environment.apiBaseUrl}/exams`, payload);
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

  getQuestionById(questionId: string): Observable<ExamQuestionSummary> {
    return this.http.get<ExamQuestionSummary>(`${environment.apiBaseUrl}/bank/questions/${questionId}`);
  }
}
