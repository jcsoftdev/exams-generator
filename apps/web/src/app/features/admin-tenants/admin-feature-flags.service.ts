import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  FeatureFlag,
  PlatformFeatureFlagDto,
  TenantFeatureFlagStateDto,
} from '@exams-generator/shared';
import { environment } from '../../../environments/environment';

/** Client for the `platform_admin`-only feature-flag routes. */
@Injectable({ providedIn: 'root' })
export class AdminFeatureFlagsService {
  private readonly http = inject(HttpClient);

  listPlatform(): Observable<PlatformFeatureFlagDto[]> {
    return this.http.get<PlatformFeatureFlagDto[]>(
      `${environment.apiBaseUrl}/feature-flags/platform`,
    );
  }

  setPlatform(key: FeatureFlag, enabled: boolean): Observable<PlatformFeatureFlagDto[]> {
    return this.http.put<PlatformFeatureFlagDto[]>(
      `${environment.apiBaseUrl}/feature-flags/platform/${key}`,
      { enabled },
    );
  }

  listForTenant(tenantId: string): Observable<TenantFeatureFlagStateDto[]> {
    return this.http.get<TenantFeatureFlagStateDto[]>(
      `${environment.apiBaseUrl}/tenants/${tenantId}/feature-flags`,
    );
  }

  setForTenant(
    tenantId: string,
    key: FeatureFlag,
    enabled: boolean,
  ): Observable<TenantFeatureFlagStateDto[]> {
    return this.http.put<TenantFeatureFlagStateDto[]>(
      `${environment.apiBaseUrl}/tenants/${tenantId}/feature-flags/${key}`,
      { enabled },
    );
  }

  /** Drops the override so the school follows the catalog default again. */
  clearForTenant(tenantId: string, key: FeatureFlag): Observable<TenantFeatureFlagStateDto[]> {
    return this.http.delete<TenantFeatureFlagStateDto[]>(
      `${environment.apiBaseUrl}/tenants/${tenantId}/feature-flags/${key}`,
    );
  }
}
