/**
 * "Which tenant did this browser last log into" hint — never a credential.
 * Set on POST /auth/login, read back by GET /auth/last-tenant so the root
 * domain's /login page can offer a redirect to the right
 * `{slug}.creaexamen.com` instead of asking for the password again. The
 * actual session (the JWT) stays in localStorage, per-origin, exactly as
 * before — this cookie only carries the slug.
 */
export const LAST_TENANT_COOKIE_NAME = "lastTenant";

const LAST_TENANT_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function lastTenantCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  domain: string | undefined;
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: isProduction(),
    // `undefined` outside production — the browser then defaults the
    // cookie's scope to the exact host that set it. A hardcoded
    // `.creaexamen.com` domain attribute is rejected by the browser for any
    // host that isn't under it (localhost, the sslip.io fallback), which
    // would silently drop the cookie in dev/CI.
    domain: isProduction() ? ".creaexamen.com" : undefined,
    sameSite: "lax",
    path: "/",
    maxAge: LAST_TENANT_COOKIE_MAX_AGE_MS,
  };
}
