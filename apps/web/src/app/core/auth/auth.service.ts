import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { Role } from '@exams-generator/shared';
import { environment } from '../../../environments/environment';
import { decodeJwtPayload } from './jwt.util';
import { DecodedAccessToken, LoginCredentials, LoginResponse } from './auth.models';

export const ACCESS_TOKEN_STORAGE_KEY = 'exams-generator.accessToken';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  private readonly tokenSignal = signal<string | null>(this.readStoredToken());
  private readonly decodedTokenSignal = computed<DecodedAccessToken | null>(() => {
    const token = this.tokenSignal();
    return token ? decodeJwtPayload<DecodedAccessToken>(token) : null;
  });

  // `token !== null` alone isn't enough — an expired token still decodes
  // fine (decoding never checks `exp`) and would sail past the guard,
  // leaving stale UI up until the first request 401s (audit P1). `exp` is
  // seconds-since-epoch; `Date.now()` is milliseconds.
  readonly isAuthenticated = computed(() => {
    const decoded = this.decodedTokenSignal();
    return decoded !== null && decoded.exp * 1000 > Date.now();
  });
  readonly currentRole = computed<Role | null>(() => this.decodedTokenSignal()?.role ?? null);
  readonly currentTenantId = computed<string | null>(
    () => this.decodedTokenSignal()?.tenantId ?? null,
  );

  login(credentials: LoginCredentials): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${environment.apiBaseUrl}/auth/login`, credentials)
      .pipe(tap((response) => this.setToken(response.accessToken)));
  }

  logout(): void {
    this.setToken(null);
  }

  getToken(): string | null {
    return this.tokenSignal();
  }

  private setToken(token: string | null): void {
    this.tokenSignal.set(token);
    if (token) {
      localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    }
  }

  private readStoredToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  }
}
