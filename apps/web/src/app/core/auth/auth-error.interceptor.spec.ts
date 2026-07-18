import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { authErrorInterceptor } from './auth-error.interceptor';
import { AuthService } from './auth.service';

describe('authErrorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  const logout = vi.fn();
  const navigateByUrl = vi.fn();

  beforeEach(() => {
    logout.mockClear();
    navigateByUrl.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { logout } },
        { provide: Router, useValue: { navigateByUrl } },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('on 401 clears session and redirects to /login?expired=1', () => {
    http.get('/api/anything').subscribe({ next: () => {}, error: () => {} });
    httpMock.expectOne('/api/anything').flush('nope', { status: 401, statusText: 'Unauthorized' });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith('/login?expired=1');
  });

  it('does NOT log out on the login request itself (avoids loop on bad credentials)', () => {
    http.post('/api/auth/login', {}).subscribe({ next: () => {}, error: () => {} });
    httpMock.expectOne('/api/auth/login').flush('bad', { status: 401, statusText: 'Unauthorized' });
    expect(logout).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('passes through non-401 errors untouched', () => {
    http.get('/api/x').subscribe({ next: () => {}, error: () => {} });
    httpMock.expectOne('/api/x').flush('boom', { status: 500, statusText: 'Server Error' });
    expect(logout).not.toHaveBeenCalled();
  });
});
