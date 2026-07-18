import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, afterEach } from 'vitest';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

describe('authInterceptor', () => {
  let httpClient: HttpClient;
  let httpMock: HttpTestingController;

  function configureWithToken(token: string | null): void {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { getToken: () => token } },
      ],
    });
    httpClient = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  }

  afterEach(() => {
    httpMock.verify();
  });

  it('attaches an Authorization header when a token is present', () => {
    configureWithToken('fake-token');

    httpClient.get('/protected/resource').subscribe();

    const req = httpMock.expectOne('/protected/resource');
    expect(req.request.headers.get('Authorization')).toBe('Bearer fake-token');
    req.flush({});
  });

  it('does not attach an Authorization header when there is no token', () => {
    configureWithToken(null);

    httpClient.get('/public/resource').subscribe();

    const req = httpMock.expectOne('/public/resource');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });
});
