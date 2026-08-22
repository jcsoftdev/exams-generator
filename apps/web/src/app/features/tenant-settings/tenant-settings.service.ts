import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';
import { TenantSettings, UpdateTenantSettingsPayload } from './tenant-settings.models';

/**
 * Angular client for the tenant-settings screen. Wires the REAL backend
 * routes (`apps/api/src/modules/tenants/tenants.controller.ts`):
 * `GET/PATCH /tenants/:id` (JSON, `{ name?, active? }`) and
 * `POST /tenants/:id/logo` (multipart, field name `file`) — there is no
 * `/tenants/me`. `TenantGuard` requires the `:id` param to match the
 * authenticated user's `tenantId`, so the id always comes from
 * `AuthService.currentTenantId()` (decoded from the JWT), never a route
 * param on this screen. `updateSettings` PATCHes the name first and, only
 * when a new logo file was selected, chains the multipart upload — the two
 * are separate backend endpoints.
 */
@Injectable({ providedIn: 'root' })
export class TenantSettingsService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  getSettings(): Observable<TenantSettings> {
    return this.http.get<TenantSettings>(
      `${environment.apiBaseUrl}/tenants/${this.requireTenantId()}`,
    );
  }

  updateSettings(payload: UpdateTenantSettingsPayload): Observable<TenantSettings> {
    const tenantId = this.requireTenantId();

    return this.http
      .patch<TenantSettings>(`${environment.apiBaseUrl}/tenants/${tenantId}`, {
        name: payload.name,
        city: payload.city,
      })
      .pipe(
        switchMap((tenant) =>
          payload.logo ? this.uploadLogo(tenantId, payload.logo) : of(tenant),
        ),
      );
  }

  private uploadLogo(tenantId: string, logo: File): Observable<TenantSettings> {
    const formData = new FormData();
    formData.set('file', logo);
    return this.http.post<TenantSettings>(
      `${environment.apiBaseUrl}/tenants/${tenantId}/logo`,
      formData,
    );
  }

  /**
   * `GET /assets/:id` is Bearer-JWT protected, so a plain `<img src>` bound
   * to the URL would 401 (same reason `bank.service.ts#fetchQuestionImage`
   * fetches through `HttpClient` instead) — fetches the SAVED logo's bytes
   * as a blob so the "Datos y logo" tab can show a 64px preview of the
   * logo that's already on the tenant, not just one just picked locally.
   */
  fetchLogo(logoAssetId: string): Observable<Blob> {
    return this.http.get(`${environment.apiBaseUrl}/assets/${logoAssetId}`, {
      responseType: 'blob',
    });
  }

  private requireTenantId(): string {
    const tenantId = this.authService.currentTenantId();
    if (!tenantId) {
      throw new Error('No hay un colegio asociado a la sesión actual.');
    }
    return tenantId;
  }
}
