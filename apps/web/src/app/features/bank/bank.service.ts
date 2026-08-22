import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  BankQuestion,
  BankQuestionFilters,
  BankTopicCount,
  CreateImageQuestionPayload,
  CreateStructuredQuestionPayload,
  PagedQuestions,
  UpdateQuestionPayload,
} from './bank.models';

/**
 * The taxonomy/difficulty query params shared by every read of the bank:
 * the unpaginated list, the paginated list, and the tree summary. Extracted
 * so the three can never drift — the tree's counts and the per-topic fetch
 * that fills them in MUST be asking the server the same question.
 */
function buildFilterParams(filters: BankQuestionFilters): HttpParams {
  let params = new HttpParams();
  if (filters.courseId) {
    params = params.set('courseId', filters.courseId);
  }
  if (filters.topicId) {
    params = params.set('topicId', filters.topicId);
  }
  if (filters.difficulty) {
    params = params.set('difficulty', filters.difficulty);
  }
  if (filters.gradeLevel) {
    params = params.set('gradeLevel', filters.gradeLevel);
  }
  return params;
}

/**
 * Angular client for the Fase 1 bank API (design doc §9):
 * `GET /bank/questions` (combinable filters) and `POST /bank/questions/image`
 * (multipart manual upload). Bearer JWT is attached automatically by
 * `authInterceptor` (see app.config.ts) — this service never touches auth
 * headers itself, mirroring AuthService's separation of concerns.
 */
@Injectable({ providedIn: 'root' })
export class BankService {
  private readonly http = inject(HttpClient);

  /**
   * Per-topic question counts (`GET /bank/questions/summary`) — the skeleton
   * the bank tree renders on entry: every course and topic with its real
   * total, and zero question payload. The filters are the same ones
   * `listQuestionsPaged` takes, so a topic's `total` is exactly what
   * expanding that topic will fetch.
   */
  getQuestionCounts(filters: BankQuestionFilters = {}): Observable<BankTopicCount[]> {
    return this.http.get<BankTopicCount[]>(`${environment.apiBaseUrl}/bank/questions/summary`, {
      params: buildFilterParams(filters),
    });
  }

  /**
   * S6: `GET /bank/questions` with `page`/`pageSize` params, returns
   * `{ items, total }`.
   */
  listQuestionsPaged(
    filters: BankQuestionFilters,
    page: number,
    pageSize: number,
  ): Observable<PagedQuestions> {
    const params = buildFilterParams(filters)
      .set('page', String(page))
      .set('pageSize', String(pageSize));

    return this.http.get<PagedQuestions>(`${environment.apiBaseUrl}/bank/questions`, { params });
  }

  /** Direct-by-id fetch for the detail panel — S6/Task 5. */
  getQuestion(id: string): Observable<BankQuestion> {
    return this.http.get<BankQuestion>(`${environment.apiBaseUrl}/bank/questions/${id}`);
  }

  /** S4: soft-removes an `approved` question (never a draft). */
  archiveQuestion(id: string): Observable<{ id: string; status: 'archived' }> {
    return this.http.patch<{ id: string; status: 'archived' }>(
      `${environment.apiBaseUrl}/bank/questions/${id}/archive`,
      {},
    );
  }

  /** S5: permanently deletes an own `draft` question. */
  deleteQuestion(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiBaseUrl}/bank/questions/${id}`);
  }

  uploadImageQuestion(payload: CreateImageQuestionPayload): Observable<{ id: string }> {
    const formData = new FormData();
    formData.set('courseId', payload.courseId);
    formData.set('topicId', payload.topicId);
    formData.set('difficulty', payload.difficulty);
    formData.set('gradeLevel', payload.gradeLevel);
    formData.set('correctAnswer', payload.correctAnswer);
    formData.set('image', payload.image);

    return this.http.post<{ id: string }>(
      `${environment.apiBaseUrl}/bank/questions/image`,
      formData,
    );
  }

  /** Task 6: creates a `structured` question (JSON body, no file upload). */
  createStructuredQuestion(payload: CreateStructuredQuestionPayload): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(
      `${environment.apiBaseUrl}/bank/questions/structured`,
      payload,
    );
  }

  /**
   * Task 7: partial update for the inline question editor. See
   * `UpdateQuestionPayload` — no `courseId`, move courses via `topicId`.
   */
  updateQuestion(id: string, patch: UpdateQuestionPayload): Observable<BankQuestion> {
    return this.http.patch<BankQuestion>(`${environment.apiBaseUrl}/bank/questions/${id}`, patch);
  }

  /**
   * Task 7: swaps the image behind an `image`-type question. Multipart
   * field name is `"file"` — NOTE this differs from `uploadImageQuestion`'s
   * `POST /bank/questions/image` (create), which uses `"image"`; the two
   * endpoints intentionally use different field names on the backend.
   */
  replaceQuestionImage(id: string, image: File): Observable<{ id: string }> {
    const formData = new FormData();
    formData.set('file', image);

    return this.http.post<{ id: string }>(
      `${environment.apiBaseUrl}/bank/questions/${id}/image`,
      formData,
    );
  }

  /**
   * `GET /bank/questions` only returns the bare `imageAssetId` UUID — this
   * builds the real `GET /assets/:id` URL that serves the image bytes.
   * NOTE: don't bind this directly to `<img src>` — that endpoint is
   * Bearer-JWT protected and `<img src>` never sends the Authorization
   * header. Use `fetchQuestionImage()` instead, which goes through
   * `HttpClient` (so `authInterceptor` attaches the header) and hands back
   * a `Blob` the caller can turn into a same-origin `blob:` object URL.
   */
  buildImageAssetUrl(imageAssetId: string): string {
    return `${environment.apiBaseUrl}/assets/${imageAssetId}`;
  }

  /**
   * Fetches the authenticated image bytes behind `imageAssetId` as a
   * `Blob`. See `buildImageAssetUrl` for why this exists instead of a
   * plain `<img src>` URL.
   */
  fetchQuestionImage(imageAssetId: string): Observable<Blob> {
    return this.http.get(this.buildImageAssetUrl(imageAssetId), { responseType: 'blob' });
  }
}
