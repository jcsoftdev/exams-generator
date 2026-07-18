import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Course, Topic } from './taxonomy.models';

/**
 * Angular client for the read-only global taxonomy catalog
 * (`GET /courses`, `GET /topics?courseId=`). Consumed by every form that
 * previously used free-text courseId/topicId inputs (bank-upload,
 * exam-blueprint, ai-generate) to populate cascading dropdowns instead.
 * Bearer JWT is attached automatically by `authInterceptor` (see
 * app.config.ts) — this service never touches auth headers itself, same
 * convention as BankService/AiService.
 */
@Injectable({ providedIn: 'root' })
export class TaxonomyService {
  private readonly http = inject(HttpClient);

  getCourses(): Observable<Course[]> {
    return this.http.get<Course[]>(`${environment.apiBaseUrl}/courses`);
  }

  getTopics(courseId: string): Observable<Topic[]> {
    const params = new HttpParams().set('courseId', courseId);
    return this.http.get<Topic[]>(`${environment.apiBaseUrl}/topics`, { params });
  }
}
