import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkTenantLookup } from './tenant-lookup.service';
import { environment } from '../../../environments/environment';

const originalLocation = window.location;

function setHostname(hostname: string): void {
  Object.defineProperty(window, 'location', {
    writable: true,
    configurable: true,
    value: { ...originalLocation, hostname, href: '' },
  });
}

describe('checkTenantLookup', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: originalLocation,
    });
  });

  it('does not call the API when the hostname is not a *.creaexamen.com subdomain', async () => {
    setHostname('localhost');

    await TestBed.runInInjectionContext(() => checkTenantLookup());

    httpMock.expectNone(() => true);
  });

  it('redirects to the landing page on a 404 (tenant does not exist)', async () => {
    setHostname('ghost-tenant.creaexamen.com');

    void TestBed.runInInjectionContext(() => checkTenantLookup());

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/tenant-lookup/ghost-tenant`);
    req.flush(null, { status: 404, statusText: 'Not Found' });

    // The promise deliberately never resolves once a redirect is triggered
    // (see the service's doc comment) — flush the microtask queue instead
    // of awaiting it.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(window.location.href).toBe(environment.landingUrl);
  });

  it('does not redirect on a 204 (tenant exists)', async () => {
    setHostname('real-tenant.creaexamen.com');

    const promise = TestBed.runInInjectionContext(() => checkTenantLookup());

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/tenant-lookup/real-tenant`);
    req.flush(null, { status: 204, statusText: 'No Content' });

    await promise;

    expect(window.location.href).toBe('');
  });

  it('does not redirect on a non-404 error (fails open)', async () => {
    setHostname('real-tenant.creaexamen.com');

    const promise = TestBed.runInInjectionContext(() => checkTenantLookup());

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/tenant-lookup/real-tenant`);
    req.flush(null, { status: 500, statusText: 'Internal Server Error' });

    await promise;

    expect(window.location.href).toBe('');
  });
});
