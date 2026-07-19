import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ExamVersion, GeneratedVersionResult } from './exam-versions.models';

/**
 * Angular client for the exam-versions endpoints. Bearer JWT is attached
 * automatically by `authInterceptor` (see app.config.ts) — this service
 * never touches auth headers itself.
 *
 * `generateVersions` (POST) triggers generation — the exam-builder screen
 * calls it once, then navigates here. `listVersions` (GET, B4) is the
 * SINGLE SOURCE OF TRUTH for download links (DECISION B4-A): POST's
 * response carries transient presigned URLs that are never re-fetchable,
 * while GET returns stable tenant-scoped `/assets/:id` paths. The versions
 * screen only ever reads via `listVersions` + `downloadAsset`.
 */
@Injectable({ providedIn: 'root' })
export class ExamVersionsService {
  private readonly http = inject(HttpClient);

  generateVersions(examId: string, versionCount: number): Observable<GeneratedVersionResult[]> {
    return this.http.post<GeneratedVersionResult[]>(
      `${environment.apiBaseUrl}/exams/${examId}/versions`,
      { versionCount },
    );
  }

  /** `GET /exams/:examId/versions` (B4) — read-only history, `pdfUrl`/`answerSheetUrl` are relative `/assets/:id` paths. */
  listVersions(examId: string): Observable<ExamVersion[]> {
    return this.http.get<ExamVersion[]>(`${environment.apiBaseUrl}/exams/${examId}/versions`);
  }

  /**
   * Fetches the authenticated bytes behind a relative `/assets/:id` path
   * (as returned by `listVersions`) as a `Blob`. Mirrors
   * `BankService.fetchQuestionImage` — `<a href>` can't send the
   * Authorization header, so downloads go through `HttpClient` and become
   * `blob:` object URLs.
   */
  downloadAsset(assetUrl: string): Observable<Blob> {
    return this.http.get(`${environment.apiBaseUrl}${assetUrl}`, { responseType: 'blob' });
  }

  /**
   * `GET /exams/:examId/versions/zip` (N1) — every form + answer sheet as one
   * ZIP. Bearer-JWT protected like `downloadAsset`, so it goes through
   * `HttpClient` (a plain `<a href>` can't send the auth header) and the
   * caller turns the `Blob` into a `blob:` object URL to trigger the save.
   */
  downloadVersionsZip(examId: string): Observable<Blob> {
    return this.http.get(`${environment.apiBaseUrl}/exams/${examId}/versions/zip`, {
      responseType: 'blob',
    });
  }
}
