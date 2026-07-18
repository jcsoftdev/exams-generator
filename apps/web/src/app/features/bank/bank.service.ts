import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { BankQuestion, BankQuestionFilters, CreateImageQuestionPayload } from './bank.models';

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

  listQuestions(filters: BankQuestionFilters = {}): Observable<BankQuestion[]> {
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

    return this.http.get<BankQuestion[]>(`${environment.apiBaseUrl}/bank/questions`, { params });
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
