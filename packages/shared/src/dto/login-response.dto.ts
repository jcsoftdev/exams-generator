/**
 * POST /auth/login 200 response body. `tenantSlug` is the subdomain the web
 * SPA is deployed on for this user's tenant ({slug}.creaexamen.com) — `null`
 * for platform staff (`platform_admin`/`content_editor`, global scope, no
 * single tenant). Callers use it to detect a cross-origin login (e.g. a
 * central login page on the root domain) and redirect to the right
 * subdomain instead of assuming same-origin.
 */
export interface LoginResponseDto {
  accessToken: string;
  tenantSlug: string | null;
}
