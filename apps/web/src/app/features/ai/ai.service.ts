import { HttpClient, HttpDownloadProgressEvent, HttpEventType, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  AiRevisedQuestion,
  CreateGenerationJobPayload,
  DraftListResult,
  DraftQuestion,
  EditDraftPayload,
  GenerateQuestionsPayload,
  GenerateQuestionStreamEvent,
  GenerationJob,
  GenerationJobChainResult,
  GenerationJobListResult,
} from './ai.models';
import { parseGenerateStreamFrames, parseGenerationJobStreamFrames } from './parse-generate-stream-frames';

/**
 * Angular client for the Fase 2 AI generation + draft review workflow
 * (design doc §5.2, §7): single-question streaming (`POST
 * /ai/questions/generate/stream`), durable batch jobs (`POST
 * /ai/questions/jobs` + polling/streaming), and the draft-review side of
 * the bank API: `GET /bank/questions?status=draft`, `POST :id/approve`,
 * `POST :id/reject`, `PATCH :id` (server-side Typst preview validation — a
 * broken edit responds 400 and is never persisted, see
 * `extract-error-message.ts`). Bearer JWT is attached automatically by
 * `authInterceptor` (see app.config.ts), same as BankService — this service
 * never touches auth headers itself.
 *
 * NOTE: there is intentionally NO buffered `POST /ai/questions/generate`
 * call here — that endpoint does not exist on the backend; batch
 * generation goes through durable jobs and single generation through the
 * stream endpoint.
 */

/**
 * Client-side watchdog (audit P0): neither `generateQuestionStream()` nor
 * `streamGenerationJob()` has a server heartbeat to lean on —
 * `GenerationJobEventsService` (apps/api) is a bare `Subject`, notified only
 * on real writes, never on a timer — so a SILENT drop (packets lost, no
 * FIN/RST) would otherwise hang the caller forever with no `error()` and no
 * further `next()`.
 *
 * The interval is derived from the server's OWN worst-case gap between two
 * frames, not guessed: `GenerationJobsProcessor.process()` notifies once per
 * question, and `generateOneItem()` (generate-questions.service.ts) retries
 * a failed compile up to `MAX_COMPILE_ATTEMPTS` (2) times, each attempt
 * bounded by the OpenRouter adapter's own `SSE_TIMEOUT_MS` idle-stall abort
 * (120s) plus the Typst compiler's `TYPST_TIMEOUT_MS` (30s) — 2 × (120s +
 * 30s) = 300s is the ceiling the SERVER ITSELF enforces before it would
 * have thrown and closed the connection on its own. `generateQuestionStream()`
 * shares this constant even though its `delta` frames are normally far more
 * frequent (one per OpenRouter chunk) — its worst legitimate gap is bounded
 * by the same `SSE_TIMEOUT_MS`+typst arithmetic mid-retry, so the same
 * ceiling applies. 360s gives ~20% margin over that 300s ceiling so this
 * watchdog can only fire on a connection that is truly silent — never on a
 * legitimately slow item.
 */
const AI_STREAM_WATCHDOG_MS = 360_000;

@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly http = inject(HttpClient);

  /**
   * Single-question generation, streamed live — `POST
   * /ai/questions/generate/stream` (no `count`, always one question).
   * Uses `HttpClient` (NOT `EventSource`) specifically so the existing
   * `authInterceptor` keeps attaching the `Authorization` header — a native
   * `EventSource` can't send custom headers at all. `responseType: 'text'` +
   * `reportProgress: true` on the XHR backend surfaces the response body
   * incrementally via `HttpDownloadProgressEvent.partialText`, which is
   * CUMULATIVE (the whole response received so far, not just the new
   * bytes) — `processedLength` tracks how much of it has already been
   * turned into complete frames.
   */
  generateQuestionStream(payload: Omit<GenerateQuestionsPayload, 'count'>): Observable<GenerateQuestionStreamEvent> {
    return this.rawGenerateQuestionStream(payload).pipe(timeout({ each: AI_STREAM_WATCHDOG_MS }));
  }

  private rawGenerateQuestionStream(
    payload: Omit<GenerateQuestionsPayload, 'count'>,
  ): Observable<GenerateQuestionStreamEvent> {
    return new Observable<GenerateQuestionStreamEvent>((subscriber) => {
      let processedLength = 0;
      let leftover = '';

      const consume = (partialText: string): void => {
        const newText = partialText.slice(processedLength);
        processedLength = partialText.length;
        const { events, remainder } = parseGenerateStreamFrames(leftover + newText);
        leftover = remainder;
        for (const event of events) {
          subscriber.next(event);
        }
      };

      const subscription = this.http
        .post(`${environment.apiBaseUrl}/ai/questions/generate/stream`, payload, {
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

  /**
   * S6-paginated `GET /bank/questions?status=draft&page=&pageSize=` —
   * `AiReviewQueueComponent`'s row fetch (docs/audit-2026-08-14.md, "`GET
   * /bank/questions` sin `page` sigue sin tope"). Replaces the old
   * `listDrafts()`, which asked the backend's retro-compat unpaginated form
   * (`page` omitted) and decoded the full flat array — exactly the shape
   * that caused the `/app/bank` 41MB P0, just waiting for a bulk AI-generation
   * run to pile up enough drafts to hurt. The caller is responsible for
   * keeping any "total drafts" badge in sync with `total`, NOT
   * `items.length` — a page is not the whole queue.
   */
  listDraftsPaged(page: number, pageSize: number): Observable<DraftListResult> {
    const params = new HttpParams()
      .set('status', 'draft')
      .set('page', String(page))
      .set('pageSize', String(pageSize));
    return this.http.get<DraftListResult>(`${environment.apiBaseUrl}/bank/questions`, { params });
  }

  /**
   * Direct-by-id fetch of a single draft — `GET /bank/questions/:id`.
   * `GenerationJobDetailComponent.loadNewQuestions()` uses this to resolve
   * each newly-created id pushed by the job stream, one request per unseen
   * id, instead of downloading the entire draft queue (the old
   * `listDrafts()`-diff-by-id technique) just to pick a handful of rows out
   * of it — its actual need was never "the queue", it was "these specific
   * ids" (docs/audit-2026-08-14.md).
   */
  getDraft(id: string): Observable<DraftQuestion> {
    return this.http.get<DraftQuestion>(`${environment.apiBaseUrl}/bank/questions/${id}`);
  }

  /**
   * Pending-drafts COUNT only, for `DraftCountService` (sidebar badge "Cola
   * de revisión · N") — asks the S6 paginated form (`page=1&pageSize=1`)
   * and reads `total`, instead of downloading rows just to call `.length`
   * on them (docs/audit-2026-08-14.md).
   */
  countDrafts(): Observable<number> {
    const params = new HttpParams().set('status', 'draft').set('page', '1').set('pageSize', '1');
    return this.http
      .get<{ items: DraftQuestion[]; total: number }>(`${environment.apiBaseUrl}/bank/questions`, {
        params,
      })
      .pipe(map((response) => response.total));
  }

  approveQuestion(id: string): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(
      `${environment.apiBaseUrl}/bank/questions/${id}/approve`,
      {},
    );
  }

  rejectQuestion(id: string): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(
      `${environment.apiBaseUrl}/bank/questions/${id}/reject`,
      {},
    );
  }

  editDraft(id: string, patch: EditDraftPayload): Observable<DraftQuestion> {
    return this.http.patch<DraftQuestion>(`${environment.apiBaseUrl}/bank/questions/${id}`, patch);
  }

  /**
   * S7: single-question Typst PDF preview, embedded via a `blob:` object
   * URL (same authenticated-blob pattern as `fetchQuestionImage` on
   * BankService). Powers the WYSIWYG print preview in the review queue.
   */
  previewDraft(id: string): Observable<Blob> {
    return this.http.get(`${environment.apiBaseUrl}/bank/questions/${id}/preview`, {
      responseType: 'blob',
    });
  }

  /**
   * Task 7: AI-assisted revision of an existing bank question ("make this
   * harder", etc.) — `POST /ai/questions/:id/revise`. See
   * `AiRevisedQuestion` re: `correctAnswer` already being a 0-based index.
   */
  reviseQuestion(id: string, instruction: string): Observable<AiRevisedQuestion> {
    return this.http.post<AiRevisedQuestion>(
      `${environment.apiBaseUrl}/ai/questions/${id}/revise`,
      { instruction },
    );
  }

  /**
   * Task 7: OCR extraction of a structured question from a photographed
   * image — `POST /ai/questions/extract`. Multipart field name is `"file"`
   * (same convention as `BankService.replaceQuestionImage`).
   */
  extractQuestionFromImage(image: File): Observable<AiRevisedQuestion> {
    const formData = new FormData();
    formData.set('file', image);

    return this.http.post<AiRevisedQuestion>(
      `${environment.apiBaseUrl}/ai/questions/extract`,
      formData,
    );
  }

  /** `POST /ai/questions/jobs` (design doc §4) — creates a durable batch job and returns immediately (202); the caller navigates to the job-detail screen and polls from there instead of waiting on this request. */
  createGenerationJob(payload: CreateGenerationJobPayload): Observable<GenerationJob> {
    return this.http.post<GenerationJob>(`${environment.apiBaseUrl}/ai/questions/jobs`, payload);
  }

  listGenerationJobs(page = 1, pageSize = 20): Observable<GenerationJobListResult> {
    const params = new HttpParams().set('page', page).set('pageSize', pageSize);
    return this.http.get<GenerationJobListResult>(`${environment.apiBaseUrl}/ai/questions/jobs`, { params });
  }

  getGenerationJob(id: string): Observable<GenerationJob> {
    return this.http.get<GenerationJob>(`${environment.apiBaseUrl}/ai/questions/jobs/${id}`);
  }

  /**
   * Server-push counterpart of `getGenerationJob()` — `GET
   * /ai/questions/jobs/:id/stream`, same `HttpClient`-text-stream auth
   * workaround as `generateQuestionStream()` (a native `EventSource` can't
   * carry the `Authorization` header). Emits the job on connect and again
   * every time the backend pushes an update (driven by
   * `GenerationJobEventsService` on the server, not a client interval),
   * completing once the connection closes — which the backend does itself
   * once the job reaches a terminal status.
   */
  streamGenerationJob(id: string): Observable<GenerationJob> {
    return this.rawStreamGenerationJob(id).pipe(timeout({ each: AI_STREAM_WATCHDOG_MS }));
  }

  private rawStreamGenerationJob(id: string): Observable<GenerationJob> {
    return new Observable<GenerationJob>((subscriber) => {
      let processedLength = 0;
      let leftover = '';

      const consume = (partialText: string): void => {
        const newText = partialText.slice(processedLength);
        processedLength = partialText.length;
        const { events, remainder } = parseGenerationJobStreamFrames(leftover + newText);
        leftover = remainder;
        for (const job of events) {
          subscriber.next(job);
        }
      };

      const subscription = this.http
        .get(`${environment.apiBaseUrl}/ai/questions/jobs/${id}/stream`, {
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

  cancelGenerationJob(id: string): Observable<GenerationJob> {
    return this.http.post<GenerationJob>(`${environment.apiBaseUrl}/ai/questions/jobs/${id}/cancel`, {});
  }

  /** `GET /ai/questions/jobs/:id/chain` — every attempt in `id`'s retry chain, oldest first ("historial de reintentos"). */
  getGenerationJobChain(id: string): Observable<GenerationJobChainResult> {
    return this.http.get<GenerationJobChainResult>(`${environment.apiBaseUrl}/ai/questions/jobs/${id}/chain`);
  }
}
