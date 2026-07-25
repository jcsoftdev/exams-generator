import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

const TOKEN_STORAGE_KEY = 'exams-generator.accessToken';

const FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;
const PAST_EXP = Math.floor(Date.now() / 1000) - 3600;

function buildFakeJwt(payload: unknown): string {
  const base64UrlEncode = (json: string) =>
    btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('starts unauthenticated when there is no stored token', () => {
    expect(service.isAuthenticated()).toBe(false);
    expect(service.currentRole()).toBeNull();
  });

  it('posts credentials to /auth/login', () => {
    service.login({ email: 'teacher@school.dev', password: 'secret' }).subscribe();

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/auth/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'teacher@school.dev', password: 'secret' });
    req.flush({ accessToken: buildFakeJwt({ sub: 'u1', role: 'teacher', tenantId: 't1', exp: FUTURE_EXP }) });
  });

  it('stores the accessToken in localStorage and exposes role/isAuthenticated on success', () => {
    const token = buildFakeJwt({ sub: 'u1', role: 'teacher', tenantId: 't1', exp: FUTURE_EXP });

    service.login({ email: 'teacher@school.dev', password: 'secret' }).subscribe();
    const req = httpMock.expectOne(`${environment.apiBaseUrl}/auth/login`);
    req.flush({ accessToken: token });

    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe(token);
    expect(service.isAuthenticated()).toBe(true);
    expect(service.currentRole()).toBe('teacher');
  });

  it('surfaces HTTP errors and does not store a token', () => {
    let capturedError: unknown = null;

    service.login({ email: 'teacher@school.dev', password: 'wrong' }).subscribe({
      next: () => {
        throw new Error('should not succeed');
      },
      error: (err) => {
        capturedError = err;
      },
    });

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/auth/login`);
    req.flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    expect(capturedError).not.toBeNull();
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('logout() clears the stored token', () => {
    const token = buildFakeJwt({ sub: 'u1', role: 'teacher', tenantId: 't1', exp: FUTURE_EXP });
    service.login({ email: 'teacher@school.dev', password: 'secret' }).subscribe();
    httpMock.expectOne(`${environment.apiBaseUrl}/auth/login`).flush({ accessToken: token });

    service.logout();

    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.currentRole()).toBeNull();
  });

  it('rehydrates isAuthenticated/currentRole from a previously stored token', () => {
    const token = buildFakeJwt({ sub: 'u1', role: 'school_admin', tenantId: 't2', exp: FUTURE_EXP });
    localStorage.setItem(TOKEN_STORAGE_KEY, token);

    // Fresh injector so the service constructor re-reads localStorage.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const rehydrated = TestBed.inject(AuthService);

    expect(rehydrated.isAuthenticated()).toBe(true);
    expect(rehydrated.currentRole()).toBe('school_admin');
  });

  it('treats an expired token as unauthenticated instead of trusting mere presence', () => {
    const expired = buildFakeJwt({ sub: 'u1', role: 'teacher', tenantId: 't1', exp: PAST_EXP });
    localStorage.setItem(TOKEN_STORAGE_KEY, expired);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const rehydrated = TestBed.inject(AuthService);

    expect(rehydrated.isAuthenticated()).toBe(false);
  });
});
