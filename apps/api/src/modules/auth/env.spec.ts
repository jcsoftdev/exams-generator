import { WEAK_JWT_SECRETS, resolveJwtSecret } from "./env";

describe("resolveJwtSecret", () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    for (const [k, v] of [
      ["JWT_SECRET", originalSecret],
      ["NODE_ENV", originalEnv],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("returns JWT_SECRET when it is a real secret", () => {
    process.env.JWT_SECRET = "a-genuinely-strong-secret-value";

    expect(resolveJwtSecret()).toBe("a-genuinely-strong-secret-value");
  });

  it("falls back to the documented default in dev/test — thousands of specs sign tokens", () => {
    delete process.env.JWT_SECRET;
    delete process.env.NODE_ENV;

    expect(resolveJwtSecret()).toBe("change-me-in-every-environment");
  });

  /**
   * The default is public — it lives in `infra/env.example` and in this repo.
   * A production API booted with it (a stray script, a half-copied .env, a
   * deploy that skipped the compose guard) signs tokens anyone can forge:
   * verified by minting a `platform_admin` token with the literal default and
   * getting 200 on `GET /tenants` (audit 2026-08-18). So in production a weak
   * secret is not a fallback — it is a refusal to boot.
   */
  it("REFUSES to boot in production with the public default", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "change-me-in-every-environment";

    expect(() => resolveJwtSecret()).toThrow(/JWT_SECRET/);
  });

  it("refuses to boot in production with NO secret at all", () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;

    expect(() => resolveJwtSecret()).toThrow(/JWT_SECRET/);
  });

  it("refuses a too-short secret in production (a 4-char value is not a secret)", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "abcd";

    expect(() => resolveJwtSecret()).toThrow(/JWT_SECRET/);
  });

  it("accepts a real secret in production", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "x".repeat(32);

    expect(resolveJwtSecret()).toBe("x".repeat(32));
  });

  it("exposes the known-weak values it guards against", () => {
    expect(WEAK_JWT_SECRETS).toContain("change-me-in-every-environment");
  });
});
