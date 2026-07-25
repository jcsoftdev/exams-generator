import { HttpClient, HttpDownloadProgressEvent, HttpEventType, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { parseExamVersionJobStreamFrames } from '../ai/parse-generate-stream-frames';
import { ExamVersion, ExamVersionJob } from './exam-versions.models';

/**
 * Angular client for the exam-versions endpoints. Bearer JWT is attached
 * automatically by `authInterceptor` (see app.config.ts) — this service
 * never touches auth headers itself.
 *
 * `generateVersions` (POST) ENQUEUES generation and resolves with the job,
 * not the forms — PDF compilation moved to a BullMQ worker (audit P0), so
 * callers follow progress via `streamVersionJob` and then re-read
 * `listVersions` (GET, B4), which stays the SINGLE SOURCE OF TRUTH for
 * download links (DECISION B4-A: stable tenant-scoped `/assets/:id` paths).
 */
@Injectable({ providedIn: 'root' })
export class ExamVersionsService {
  private readonly http = inject(HttpClient);

  /** Enqueues generation. Resolves as soon as the job row exists (HTTP 202) — the forms do not exist yet. */
  generateVersions(examId: string, versionCount: number): Observable<ExamVersionJob> {
    return this.http.post<ExamVersionJob>(`${environment.apiBaseUrl}/exams/${examId}/versions`, {
      versionCount,
    });
  }

  /**
   * The exam's most recent generation job, or `null` if it was never
   * generated. Lets the versions screen re-attach to a run still in flight
   * after a reload — the job id from the original POST is gone by then.
   */
  latestVersionJob(examId: string): Observable<ExamVersionJob | null> {
    return this.http.get<ExamVersionJob | null>(
      `${environment.apiBaseUrl}/exams/${examId}/versions/jobs/latest`,
    );
  }

  /**
   * Live progress for one job — `GET .../versions/jobs/:jobId/stream`. Same
   * `HttpClient`-text-stream workaround as `AiService.streamGenerationJob()`
   * (a native `EventSource` cannot carry the `Authorization` header
   * `JwtAuthGuard` requires): read `partialText` as it grows, parse whole
   * `data: {...}\n\n` frames out of it, emit one job per frame. Emits on
   * connect, again per generated form, and completes when the backend closes
   * the connection at a terminal status.
   */
  streamVersionJob(examId: string, jobId: string): Observable<ExamVersionJob> {
    return new Observable<ExamVersionJob>((subscriber) => {
      let processedLength = 0;
      let leftover = '';

      const consume = (partialText: string): void => {
        const newText = partialText.slice(processedLength);
        processedLength = partialText.length;
        const { events, remainder } = parseExamVersionJobStreamFrames(leftover + newText);
        leftover = remainder;
        for (const job of events) {
          subscriber.next(job);
        }
      };

      const subscription = this.http
        .get(`${environment.apiBaseUrl}/exams/${examId}/versions/jobs/${jobId}/stream`, {
          observe: 'events',
          responseType: 'text',
          reportProgress: true,
        })
        .subscribe({
          next: (event) => {
            if (event.type === HttpEventType.DownloadProgress) {
              consume((event as HttpDownloadProgressEvent).partialText ?? '');
            } else if (event.type === HttpEventType.Response) {
              consume((event as HttpResponse<string>).body ?? '');
              subscriber.complete();
            }
          },
          error: (err) => subscriber.error(err),
        });

      return () => subscription.unsubscribe();
    });
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
