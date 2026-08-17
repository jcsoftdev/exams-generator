import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export const TENANT_ROOT_DOMAIN = '.creaexamen.com';

/** `foo.creaexamen.com` -> `'foo'`. `creaexamen.com` / `localhost` / the sslip.io fallback -> `null`. */
export function extractTenantSlug(hostname: string): string | null {
  if (!hostname.endsWith(TENANT_ROOT_DOMAIN)) {
    return null;
  }
  const labels = hostname.split('.');
  return labels.length > 2 ? labels[0] : null;
}

/**
 * Is this host part of the tenant-subdomain scheme at all?
 *
 * `extractTenantSlug` collapses two very different answers into `null`: "this
 * IS the tenant root, no subdomain" (`creaexamen.com`) and "this host has
 * nothing to do with tenant subdomains" (`localhost`, the sslip.io fallback).
 * Callers deciding whether to hand a session across origins need them apart —
 * treating the second as the first sent every local login to production.
 */
export function isTenantScopedHost(hostname: string): boolean {
  return hostname === TENANT_ROOT_DOMAIN.slice(1) || hostname.endsWith(TENANT_ROOT_DOMAIN);
}

/**
 * Pre-login guard: a tenant subdomain that doesn't map to a real tenant
 * redirects to the landing page before the app renders anything. Wired into
 * `app.config.ts` via `provideAppInitializer`. Only a definitive 404 means
 * "tenant does not exist" — any other outcome (204, network error, 5xx,
 * timeout) fails open so a transient API hiccup never locks a real tenant
 * out of its own subdomain. On redirect the returned promise never
 * resolves, so the app never finishes bootstrapping and content never
 * flashes while the browser navigates away.
 */
export function checkTenantLookup(): Promise<void> {
  const http = inject(HttpClient);
  const slug = extractTenantSlug(window.location.hostname);

  if (!slug) {
    return Promise.resolve();
  }

  return firstValueFrom(http.get(`${environment.apiBaseUrl}/tenant-lookup/${slug}`)).then(
    () => undefined,
    (error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        window.location.href = environment.landingUrl;
        return new Promise<void>(() => {});
      }
      return undefined;
    },
  );
}
