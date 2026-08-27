import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
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

  /**
   * `gradeLevel` scopes the catalog to that grade's educational stage
   * (escuela | colegio | preuniversitario). Omitted → the full catalog, so
   * callers without a grade context keep working unchanged.
   */
  getCourses(gradeLevel?: string): Observable<Course[]> {
    let params = new HttpParams();
    if (gradeLevel) {
      params = params.set('gradeLevel', gradeLevel);
    }
    return this.http.get<Course[]>(`${environment.apiBaseUrl}/courses`, { params });
  }

  /** `gradeLevel` returns only the topics assessed at that grade; omitted → every topic of the course. */
  getTopics(courseId: string, gradeLevel?: string): Observable<Topic[]> {
    let params = new HttpParams().set('courseId', courseId);
    if (gradeLevel) {
      params = params.set('gradeLevel', gradeLevel);
    }
    return this.http.get<Topic[]>(`${environment.apiBaseUrl}/topics`, { params });
  }

  /**
   * Batched sibling of `getTopics` — fetches topics for MULTIPLE courses in
   * one request (backend's comma-separated `courseId` form) instead of one
   * `getTopics(courseId)` call per course. Fixes the N+1 fan-out that used
   * to trip the global `ThrottlerGuard` when callers fetched topics for
   * every course in parallel via `forkJoin`. Blank/whitespace-only ids are
   * dropped before the empty check, so `['']` resolves with `[]` the same
   * way `[]` does instead of silently falling back to "no filter" (which
   * would return the entire catalog).
   */
  getTopicsForCourses(courseIds: string[], gradeLevel?: string): Observable<Topic[]> {
    const ids = courseIds.map((id) => id.trim()).filter((id) => id.length > 0);
    if (ids.length === 0) {
      return of([]);
    }
    let params = new HttpParams().set('courseId', ids.join(','));
    if (gradeLevel) {
      params = params.set('gradeLevel', gradeLevel);
    }
    return this.http.get<Topic[]>(`${environment.apiBaseUrl}/topics`, { params });
  }

  /**
   * Every topic in the catalog, in ONE request that depends on nothing.
   *
   * `getTopicsForCourses` deliberately refuses to fall back to "no filter"
   * when handed an empty id list — that would turn a bug into a silent
   * full-catalog fetch. So wanting the whole catalog has to be said out loud,
   * which is what this is.
   *
   * It exists because the bank tree spans every course anyway: it called
   * `getCourses()` purely to collect ids it then passed straight back as a
   * filter that excluded nothing. Chaining those two round-trips cost ~620ms
   * of pure latency against a France origin for a result identical to asking
   * once (docs/audit-2026-08-26-prod-latency.md §2). Every topic has a course
   * (`topics.course_id` is NOT NULL), so the two sets are the same set.
   */
  getAllTopics(gradeLevel?: string): Observable<Topic[]> {
    const params = gradeLevel ? new HttpParams().set('gradeLevel', gradeLevel) : undefined;
    return this.http.get<Topic[]>(`${environment.apiBaseUrl}/topics`, params ? { params } : {});
  }
}
