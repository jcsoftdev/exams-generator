import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal } from '@angular/core';
import { TenantSettingsService } from './tenant-settings.service';
import { AuthService } from '../../core/auth/auth.service';
import { environment } from '../../../environments/environment';
import { TenantSettings } from './tenant-settings.models';

describe('TenantSettingsService', () => {
  let service: TenantSettingsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { currentTenantId: signal('tenant-1') } },
      ],
    });
    service = TestBed.inject(TenantSettingsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('getSettings', () => {
    it('GETs /tenants/:id using the current tenant id from AuthService', () => {
      service.getSettings().subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/tenants/tenant-1`);
      expect(req.request.method).toBe('GET');
      req.flush({ id: 'tenant-1', name: 'Colegio X', logoAssetId: null });
    });

    it('resolves with the tenant settings returned by the API', () => {
      const settings: TenantSettings = { id: 'tenant-1', name: 'Colegio X', city: 'Arequipa', logoAssetId: 'asset-1' };
      let result: TenantSettings | undefined;

      service.getSettings().subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/tenants/tenant-1`);
      req.flush(settings);

      expect(result).toEqual(settings);
    });
  });

  describe('updateSettings', () => {
    it('PATCHes /tenants/:id with a JSON body containing the name and city when no logo is provided', () => {
      service.updateSettings({ name: 'Colegio Nuevo', city: 'Arequipa' }).subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/tenants/tenant-1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ name: 'Colegio Nuevo', city: 'Arequipa' });
      req.flush({ id: 'tenant-1', name: 'Colegio Nuevo', city: 'Arequipa', logoAssetId: null });
    });

    it('PATCHes the name/city and then POSTs the logo to /tenants/:id/logo as multipart when a file is provided', () => {
      const logo = new File(['fake-bytes'], 'logo.png', { type: 'image/png' });

      let result: TenantSettings | undefined;
      service
        .updateSettings({ name: 'Colegio Nuevo', city: 'Arequipa', logo })
        .subscribe((response) => (result = response));

      const patchReq = httpMock.expectOne(`${environment.apiBaseUrl}/tenants/tenant-1`);
      expect(patchReq.request.method).toBe('PATCH');
      expect(patchReq.request.body).toEqual({ name: 'Colegio Nuevo', city: 'Arequipa' });
      patchReq.flush({ id: 'tenant-1', name: 'Colegio Nuevo', city: 'Arequipa', logoAssetId: null });

      const logoReq = httpMock.expectOne(`${environment.apiBaseUrl}/tenants/tenant-1/logo`);
      expect(logoReq.request.method).toBe('POST');
      expect(logoReq.request.body).toBeInstanceOf(FormData);
      const body = logoReq.request.body as FormData;
      expect(body.get('file')).toBe(logo);
      logoReq.flush({ id: 'tenant-1', name: 'Colegio Nuevo', city: 'Arequipa', logoAssetId: 'asset-2' });

      expect(result).toEqual({ id: 'tenant-1', name: 'Colegio Nuevo', city: 'Arequipa', logoAssetId: 'asset-2' });
    });
  });

  describe('fetchLogo', () => {
    it('GETs /assets/:id as a blob (authInterceptor attaches the Bearer header; <img src> cannot)', () => {
      let result: Blob | undefined;

      service.fetchLogo('asset-1').subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/assets/asset-1`);
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');

      const blob = new Blob(['fake-bytes'], { type: 'image/png' });
      req.flush(blob);

      expect(result).toEqual(blob);
    });
  });
});

describe('TenantSettingsService (no tenant id)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { currentTenantId: signal(null) } },
      ],
    });
  });

  it('throws when there is no current tenant id available', () => {
    const service = TestBed.inject(TenantSettingsService);
    expect(() => service.getSettings()).toThrow();
  });
});
