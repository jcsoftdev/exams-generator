import { LAST_TENANT_COOKIE_NAME, lastTenantCookieOptions } from "./cookie.util";

describe("lastTenantCookieOptions", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  it("exposes the cookie name", () => {
    expect(LAST_TENANT_COOKIE_NAME).toBe("lastTenant");
  });

  it("scopes the cookie to the tenant root domain in production", () => {
    process.env.NODE_ENV = "production";

    const options = lastTenantCookieOptions();

    expect(options.domain).toBe(".creaexamen.com");
    expect(options.secure).toBe(true);
  });

  // No `domain` attribute outside production — a hardcoded `.creaexamen.com`
  // is rejected by the browser for any host that isn't under it (localhost,
  // the sslip.io fallback), which would silently drop the cookie in dev/CI.
  it("omits the domain attribute and secure flag outside production", () => {
    process.env.NODE_ENV = "test";

    const options = lastTenantCookieOptions();

    expect(options.domain).toBeUndefined();
    expect(options.secure).toBe(false);
  });

  it("is always httpOnly, SameSite=Lax, root-pathed, and JS on the page can never read it", () => {
    const options = lastTenantCookieOptions();

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });
});
