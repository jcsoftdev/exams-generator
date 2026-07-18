import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  DraftQuestion,
  EditDraftPayload,
  GenerateQuestionsPayload,
  GenerateQuestionsResult,
} from './ai.models';

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
}
