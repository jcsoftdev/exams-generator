/**
 * GET /auth/last-tenant 200 response body. `slug` is the tenant subdomain
 * ({slug}.creaexamen.com) the caller's browser last logged into, read from
 * the `lastTenant` cookie set by POST /auth/login — `null` when no cookie is
 * present (never logged in on this browser, or the last login was a
 * platform-staff account with no tenant). Lets the root domain's /login page
 * offer a redirect to the right subdomain instead of asking for credentials
 * again, without exposing the actual session (the cookie carries only the
 * slug, never the access token).
 */
export interface LastTenantResponseDto {
  slug: string | null;
}
