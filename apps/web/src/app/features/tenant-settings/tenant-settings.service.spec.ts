import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TenantSettingsService } from './tenant-settings.service';
import { environment } from '../../../environments/environment';
import { TenantSettings } from './tenant-settings.models';

describe('TenantSettingsService', () => {
  let service: TenantSettingsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TenantSettingsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('getSettings', () => {
    it('GETs /tenants/me', () => {
      service.getSettings().subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/tenants/me`);
      expect(req.request.method).toBe('GET');
      req.flush({ id: 'tenant-1', name: 'Colegio X', logoAssetId: null });
    });

    it('resolves with the tenant settings returned by the API', () => {
      const settings: TenantSettings = { id: 'tenant-1', name: 'Colegio X', logoAssetId: 'asset-1' };
      let result: TenantSettings | undefined;

      service.getSettings().subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/tenants/me`);
      req.flush(settings);

      expect(result).toEqual(settings);
    });
  });

  describe('updateSettings', () => {
    it('PATCHes /tenants/me with a multipart FormData containing name and logo', () => {
      const logo = new File(['fake-bytes'], 'logo.png', { type: 'image/png' });

      service.updateSettings({ name: 'Colegio Nuevo', logo }).subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/tenants/me`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toBeInstanceOf(FormData);

      const body = req.request.body as FormData;
      expect(body.get('name')).toBe('Colegio Nuevo');
      expect(body.get('logo')).toBe(logo);

      req.flush({ id: 'tenant-1', name: 'Colegio Nuevo', logoAssetId: 'asset-2' });
    });

    it('omits the logo field entirely when no new file is provided', () => {
      service.updateSettings({ name: 'Colegio Nuevo' }).subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/tenants/me`);
      const body = req.request.body as FormData;
      expect(body.get('logo')).toBeNull();
      req.flush({ id: 'tenant-1', name: 'Colegio Nuevo', logoAssetId: null });
    });
  });
});
