import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  CreateUserPayload,
  CreateUserResult,
  ResetPasswordResult,
  SetActiveResult,
  TenantUser,
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

  list(): Observable<TenantUser[]> {
    return this.http.get<TenantUser[]>(`${environment.apiBaseUrl}/users`);
  }

  create(payload: CreateUserPayload): Observable<CreateUserResult> {
    return this.http.post<CreateUserResult>(`${environment.apiBaseUrl}/users`, payload);
  }

  setActive(id: string, active: boolean): Observable<SetActiveResult> {
    return this.http.patch<SetActiveResult>(`${environment.apiBaseUrl}/users/${id}`, { active });
  }

  resetPassword(id: string): Observable<ResetPasswordResult> {
    return this.http.post<ResetPasswordResult>(`${environment.apiBaseUrl}/users/${id}/reset-password`, {});
  }
}
