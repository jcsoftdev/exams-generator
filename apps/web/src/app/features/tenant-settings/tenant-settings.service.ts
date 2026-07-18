import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { TenantSettings, UpdateTenantSettingsPayload } from './tenant-settings.models';

/**
 * Angular client for the tenant-settings screen. See `tenant-settings.models.ts`
 * for the documented GAP: `/tenants/me` does not exist on the backend yet —
 * this is the frontend contract the screen is built against. Bearer JWT is
 * attached automatically by `authInterceptor` (see app.config.ts), same as
 * every other feature service.
 */
@Injectable({ providedIn: 'root' })
export class TenantSettingsService {
  private readonly http = inject(HttpClient);

  getSettings(): Observable<TenantSettings> {
    return this.http.get<TenantSettings>(`${environment.apiBaseUrl}/tenants/me`);
  }

  updateSettings(payload: UpdateTenantSettingsPayload): Observable<TenantSettings> {
    const formData = new FormData();
    formData.set('name', payload.name);
    if (payload.logo) {
      formData.set('logo', payload.logo);
    }

    return this.http.patch<TenantSettings>(`${environment.apiBaseUrl}/tenants/me`, formData);
  }
}
