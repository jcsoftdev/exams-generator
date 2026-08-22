import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  CreateUserPayload,
  CreateUserResult,
  PagedTenantUsers,
  ResetPasswordResult,
  SetActiveResult,
} from './users.models';

/**
 * Client for `apps/api/src/modules/users/users.controller.ts` (S8).
 * The controller is `@Roles(Role.SchoolAdmin)`-only and derives the tenant
 * from `@CurrentUser()` — no tenant id is sent in the URL, unlike
 * `TenantSettingsService` (tenants module).
 */
@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly http = inject(HttpClient);

  list(page = 1, pageSize = 20): Observable<PagedTenantUsers> {
    const params = new HttpParams().set('page', page).set('pageSize', pageSize);
    return this.http.get<PagedTenantUsers>(`${environment.apiBaseUrl}/users`, { params });
  }

  create(payload: CreateUserPayload): Observable<CreateUserResult> {
    return this.http.post<CreateUserResult>(`${environment.apiBaseUrl}/users`, payload);
  }

  setActive(id: string, active: boolean): Observable<SetActiveResult> {
    return this.http.patch<SetActiveResult>(`${environment.apiBaseUrl}/users/${id}`, { active });
  }

  resetPassword(id: string): Observable<ResetPasswordResult> {
    return this.http.post<ResetPasswordResult>(
      `${environment.apiBaseUrl}/users/${id}/reset-password`,
      {},
    );
  }
}
