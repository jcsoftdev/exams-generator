import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  BankFolderNode,
  BankFoldersResponse,
  DeleteBankFolderResponse,
} from '@exams-generator/shared';
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
  if (filters.folderId) {
    params = params.set('folderId', filters.folderId);
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
    // B9 (audit L1): image-only questions otherwise have nothing to show as
    // a title in the bank list — the API already accepts this optional
    // field, so pass the picked file's own name through.
    formData.set('sourceName', payload.image.name);
    if (payload.folderId) {
      formData.set('folderId', payload.folderId);
    }

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

  /**
   * The 320px WebP form of the same asset, for the tree's 40px leaf row.
   *
   * Only that row uses it. These are IMAGE questions — the statement and the
   * alternatives are inside the picture — so the views a teacher actually
   * READS (the selected question's panel, the edit preview) keep asking
   * `fetchQuestionImage` for the original. The leaf row is the one that
   * renders 50 at a time, which is where the weight was
   * (docs/audit-2026-08-26-prod-latency.md §3.2).
   */
  fetchQuestionThumbnail(imageAssetId: string): Observable<Blob> {
    return this.http.get(`${this.buildImageAssetUrl(imageAssetId)}/thumb`, {
      responseType: 'blob',
    });
  }

  /**
   * Attaches images to the alternative slots that have one. `indexes` names
   * the slot for each image, so a question with drawings on only a) and c)
   * uploads exactly two files (see the API's `resolveAlternativeSlots`).
   */
  setAlternativeImages(
    id: string,
    crops: readonly { alternativeIndex: number; file: File }[],
  ): Observable<{ id: string }> {
    const formData = new FormData();
    for (const crop of crops) {
      formData.append('images', crop.file);
      formData.append('indexes', String(crop.alternativeIndex));
    }

    return this.http.post<{ id: string }>(
      `${environment.apiBaseUrl}/bank/questions/${id}/alternative-images`,
      formData,
    );
  }

  /**
   * The tenant's folder tree with per-folder counts. The FIRST call by a tenant
   * that has never been seeded also triggers the server-side seeding, so this is
   * slower exactly once, ever — and never for anyone else.
   */
  getFolders(): Observable<BankFoldersResponse> {
    return this.http.get<BankFoldersResponse>(`${environment.apiBaseUrl}/bank/folders`);
  }

  createFolder(body: { name: string; parentId: string | null }): Observable<BankFolderNode> {
    return this.http.post<BankFolderNode>(`${environment.apiBaseUrl}/bank/folders`, body);
  }

  /** Renames and/or moves. Omit a key to leave it alone; `parentId: null` moves to the root. */
  updateFolder(
    id: string,
    patch: { name?: string; parentId?: string | null },
  ): Observable<BankFolderNode> {
    return this.http.patch<BankFolderNode>(`${environment.apiBaseUrl}/bank/folders/${id}`, patch);
  }

  /** Returns the counts the post-delete banner shows — the questions themselves are never deleted. */
  deleteFolder(id: string): Observable<DeleteBankFolderResponse> {
    return this.http.delete<DeleteBankFolderResponse>(
      `${environment.apiBaseUrl}/bank/folders/${id}`,
    );
  }
}
