import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ConfirmExamResult,
  CreateExamPayload,
  CreateExamResult,
  DuplicateExamResult,
  ExamDetail,
  ExamListFilters,
  ExamListResult,
  ExamType,
  PreviewExamPayload,
  PreviewExamResult,
  ReplaceQuestionPayload,
  ReplaceQuestionResult,
  ResolveBlueprintPayload,
  ResolveBlueprintResult,
  StockBatchPayload,
  GradeLevelStockResult,
  StockBatchResult,
  Track,
  University,
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
    return this.http.post<ConfirmExamResult>(
      `${environment.apiBaseUrl}/exams/${examId}/confirm`,
      {},
    );
  }

  /** `POST /exams/stock/batch` (B1) — pure read, order-matched availability per cell. */
  stockBatch(payload: StockBatchPayload): Observable<StockBatchResult> {
    return this.http.post<StockBatchResult>(`${environment.apiBaseUrl}/exams/stock/batch`, payload);
  }

  /**
   * `GET /exams/stock/grades` — approved-question count per grade level. Feeds
   * the "Grado" dropdown so it can flag the grades with no bank BEFORE the
   * teacher picks one (audit 2026-08-15: 11 of 12 dead-ended). Returns the FULL
   * catalog, zeros included.
   */
  gradeLevelStock(): Observable<GradeLevelStockResult> {
    return this.http.get<GradeLevelStockResult>(`${environment.apiBaseUrl}/exams/stock/grades`);
  }

  /** `POST /exams/preview` (B2) — same body shape as `createExam` minus `title`; pure read, no persistence. */
  previewExam(payload: PreviewExamPayload): Observable<PreviewExamResult> {
    return this.http.post<PreviewExamResult>(`${environment.apiBaseUrl}/exams/preview`, payload);
  }

  /** `GET /exams` (S1) — paginated exam history for the "Exámenes" screen. */
  listExams(filters: ExamListFilters): Observable<ExamListResult> {
    let params = new HttpParams();
    if (filters.status) params = params.set('status', filters.status);
    if (filters.gradeLevel) params = params.set('gradeLevel', filters.gradeLevel);
    if (filters.search) params = params.set('search', filters.search);
    if (filters.page) params = params.set('page', String(filters.page));
    if (filters.pageSize) params = params.set('pageSize', String(filters.pageSize));
    return this.http.get<ExamListResult>(`${environment.apiBaseUrl}/exams`, { params });
  }

  /** `POST /exams/:id/duplicate` (S2) — clones an exam into a fresh draft. */
  duplicateExam(examId: string): Observable<DuplicateExamResult> {
    return this.http.post<DuplicateExamResult>(
      `${environment.apiBaseUrl}/exams/${examId}/duplicate`,
      {},
    );
  }

  /** `DELETE /exams/:id` (S3). */
  /** `PATCH /exams/:examId` (S4) — rename; the only mutable field of an exam. */
  renameExam(examId: string, title: string): Observable<{ id: string; title: string }> {
    return this.http.patch<{ id: string; title: string }>(
      `${environment.apiBaseUrl}/exams/${examId}`,
      { title },
    );
  }

  deleteExam(examId: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiBaseUrl}/exams/${examId}`);
  }

  /** `GET /universities` (design doc §3.11) — global admission university catalog, no tenant scoping. */
  getUniversities(): Observable<University[]> {
    return this.http.get<University[]>(`${environment.apiBaseUrl}/universities`);
  }

  /**
   * `GET /universities/:universityId/tracks` — a university's tracks.
   * An empty array is a normal, expected response for a university with no
   * track concept (design doc §3.1) — not an error, the exam-builder screen
   * simply skips rendering the Track select in that case.
   */
  getUniversityTracks(universityId: string): Observable<Track[]> {
    return this.http.get<Track[]>(`${environment.apiBaseUrl}/universities/${universityId}/tracks`);
  }

  /** `GET /exam-types` — the data-driven exam type catalog (manual/fastest/eta/eta_by_week), ordered by sortOrder. */
  getExamTypes(): Observable<ExamType[]> {
    return this.http.get<ExamType[]>(`${environment.apiBaseUrl}/exam-types`);
  }

  /**
   * `POST /exams/blueprint/resolve` (design doc §3.11) — pre-fills the
   * manual blueprint builder for a template-backed exam type. Pure read, no
   * persistence, same convention as `previewExam`/`stockBatch`; never
   * creates or mutates an exam.
   */
  resolveBlueprint(payload: ResolveBlueprintPayload): Observable<ResolveBlueprintResult> {
    return this.http.post<ResolveBlueprintResult>(
      `${environment.apiBaseUrl}/exams/blueprint/resolve`,
      payload,
    );
  }
}
