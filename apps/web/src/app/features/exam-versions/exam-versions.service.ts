import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GeneratedVersionResult } from './exam-versions.models';

/**
 * Angular client for `POST /exams/:examId/versions`. Bearer JWT is attached
 * automatically by `authInterceptor` (see app.config.ts) — this service
 * never touches auth headers itself.
 *
 * There is no GET endpoint for previously-generated versions: the API only
 * exposes generation (POST). This service intentionally has no `list*`
 * method — the panel calls `generateVersions` on demand and renders the
 * response it gets back.
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
}
