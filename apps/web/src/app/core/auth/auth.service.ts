import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { MeResponseDto, Role } from '@exams-generator/shared';
import { environment } from '../../../environments/environment';
import { decodeJwtPayload } from './jwt.util';
import {
  DecodedAccessToken,
  ExchangeTokenResponse,
  LoginCredentials,
  LoginResponse,
} from './auth.models';

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

  /**
   * Cross-origin login handoff, step 1: mint a short-lived one-time code for
   * `accessToken` so a redirect to the target tenant's subdomain can carry
   * the code instead of the real 24h JWT (see `packages/shared`'s
   * `login-exchange.dto.ts`). Deliberately does NOT call `setToken` — this
   * origin isn't the token's home if a redirect is about to happen.
   */
  requestExchangeCode(accessToken: string): Observable<{ code: string }> {
    return this.http.post<{ code: string }>(`${environment.apiBaseUrl}/auth/exchange-code`, {
      accessToken,
    });
  }

  /** Cross-origin login handoff, step 2: redeem a one-time code for the real accessToken. Called from `/auth/callback` on the target tenant's subdomain. */
  exchangeCode(code: string): Observable<ExchangeTokenResponse> {
    return this.http.post<ExchangeTokenResponse>(`${environment.apiBaseUrl}/auth/exchange`, { code });
  }

  /** Public entry point for `/auth/callback` to store a token obtained via `exchangeCode()` — same storage path `login()` uses internally via `setToken`. */
  applyToken(token: string): void {
    this.setToken(token);
  }

  /**
   * The signed-in user's OWN identity (name/email/role/tenantId) — the JWT
   * itself only carries `sub`/`role`/`tenantId` (see `DecodedAccessToken`),
   * not name/email, so callers that need those (the shell's user menu) hit
   * `GET /auth/me` instead of decoding the token further.
   */
  me(): Observable<MeResponseDto> {
    return this.http.get<MeResponseDto>(`${environment.apiBaseUrl}/auth/me`);
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
