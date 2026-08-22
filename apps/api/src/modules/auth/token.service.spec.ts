import { Role } from "@exams-generator/shared";
import jwt from "jsonwebtoken";
import { InvalidTokenError, TokenService } from "./token.service";

describe("TokenService", () => {
  const service = new TokenService("test-secret");

  /**
   * Audit 2026-08-18: there is no token revocation, so the TTL IS the ceiling
   * on how long a deactivated/compromised account keeps access after login
   * already refuses it a new token. It was 24h; capped at a work day (8h) so a
   * fired teacher is cut off same-day, while a teacher mid-session isn't kicked
   * hourly. The 401 path is graceful (redirect to /login?expired=1) and the
   * exam builder persists in-progress work to sessionStorage, so an expiry mid-
   * work is recoverable. If revocation is ever added, this ceiling can relax.
   */
  it("issues tokens that expire within a work day (revocation window ceiling)", () => {
    const token = service.sign({ sub: "u1", tenantId: "t1", role: Role.Teacher });
    const decoded = jwt.decode(token) as { iat: number; exp: number };

    const lifetimeSeconds = decoded.exp - decoded.iat;
    expect(lifetimeSeconds).toBeGreaterThan(0);
    expect(lifetimeSeconds).toBeLessThanOrEqual(8 * 60 * 60);
  });

  it("sign() then verify() round-trips the exact payload", () => {
    const token = service.sign({
      sub: "user-1",
      tenantId: "tenant-1",
      role: Role.Teacher,
    });

    const decoded = service.verify(token);

    expect(decoded).toEqual({
      sub: "user-1",
      tenantId: "tenant-1",
      role: Role.Teacher,
    });
  });

  it("sign() preserves a null tenantId for platform staff", () => {
    const token = service.sign({
      sub: "staff-1",
      tenantId: null,
      role: Role.PlatformAdmin,
    });

    const decoded = service.verify(token);

    expect(decoded.tenantId).toBeNull();
  });

  it("verify() throws InvalidTokenError for a token signed with a different secret", () => {
    const foreignToken = new TokenService("other-secret").sign({
      sub: "user-1",
      tenantId: null,
      role: Role.ContentEditor,
    });

    expect(() => service.verify(foreignToken)).toThrow(InvalidTokenError);
  });

  it("verify() throws InvalidTokenError for a malformed token", () => {
    expect(() => service.verify("not-a-jwt")).toThrow(InvalidTokenError);
  });

  it("verify() throws InvalidTokenError for an expired token", () => {
    const expired = jwt.sign({ sub: "user-1", tenantId: null, role: Role.Teacher }, "test-secret", {
      expiresIn: -1,
    });

    expect(() => service.verify(expired)).toThrow(InvalidTokenError);
  });

  it("verify() throws InvalidTokenError when the payload is missing required fields", () => {
    const incomplete = jwt.sign({ sub: "user-1" }, "test-secret");

    expect(() => service.verify(incomplete)).toThrow(InvalidTokenError);
  });
});
