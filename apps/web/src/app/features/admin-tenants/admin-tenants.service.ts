import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DeleteTenantResult } from '@exams-generator/shared';
import { AdminTenant, CreateTenantPayload, PagedAdminTenants, UpdateTenantPayload } from './admin-tenants.models';

/** Client for the `platform_admin`-only `/tenants` CRUD endpoints. */
@Injectable({ providedIn: 'root' })
export class AdminTenantsService {
  private readonly http = inject(HttpClient);

  list(page = 1, pageSize = 20): Observable<PagedAdminTenants> {
    const params = new HttpParams().set('page', page).set('pageSize', pageSize);
    return this.http.get<PagedAdminTenants>(`${environment.apiBaseUrl}/tenants`, { params });
  }

  create(payload: CreateTenantPayload): Observable<AdminTenant> {
    return this.http.post<AdminTenant>(`${environment.apiBaseUrl}/tenants`, payload);
  }

  update(id: string, payload: UpdateTenantPayload): Observable<AdminTenant> {
    return this.http.patch<AdminTenant>(`${environment.apiBaseUrl}/tenants/${id}`, payload);
  }

  remove(id: string): Observable<DeleteTenantResult> {
    return this.http.delete<DeleteTenantResult>(`${environment.apiBaseUrl}/tenants/${id}`);
  }
}
