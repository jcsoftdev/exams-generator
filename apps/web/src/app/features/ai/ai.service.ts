import { HttpClient, HttpDownloadProgressEvent, HttpEventType, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  AiRevisedQuestion,
  CreateGenerationJobPayload,
  DraftQuestion,
  EditDraftPayload,
  GenerateQuestionsPayload,
  GenerateQuestionsResult,
  GenerateQuestionStreamEvent,
  GenerationJob,
  GenerationJobChainResult,
  GenerationJobListResult,
} from './ai.models';
import { parseGenerateStreamFrames, parseGenerationJobStreamFrames } from './parse-generate-stream-frames';

/**
 * Angular client for the Fase 2 AI generation + draft review workflow
 * (design doc §5.2, §7): `POST /ai/questions/generate` (batch, partial
 * failure per item — see `GenerateQuestionsResult`) and the draft-review
 * side of the bank API: `GET /bank/questions?status=draft`,
 * `POST :id/approve`, `POST :id/reject`, `PATCH :id` (server-side Typst
 * preview validation — a broken edit responds 400 and is never
 * persisted, see `extract-error-message.ts`). Bearer JWT is attached
 * automatically by `authInterceptor` (see app.config.ts), same as
 * BankService — this service never touches auth headers itself.
 */
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly http = inject(HttpClient);

  generateQuestions(payload: GenerateQuestionsPayload): Observable<GenerateQuestionsResult> {
    return this.http.post<GenerateQuestionsResult>(
      `${environment.apiBaseUrl}/ai/questions/generate`,
      payload,
    );
  }

  /**
   * Streaming counterpart of `generateQuestions()` — `POST
   * /ai/questions/generate/stream`, always a single question (no `count`).
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

  listDrafts(): Observable<DraftQuestion[]> {
    const params = new HttpParams().set('status', 'draft');
    return this.http.get<DraftQuestion[]>(`${environment.apiBaseUrl}/bank/questions`, { params });
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
