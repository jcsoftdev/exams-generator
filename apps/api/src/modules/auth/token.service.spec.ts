import { Role } from "@exams-generator/shared";
import jwt from "jsonwebtoken";
import { InvalidTokenError, TokenService } from "./token.service";

describe("TokenService", () => {
  const service = new TokenService("test-secret");

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
    const expired = jwt.sign(
      { sub: "user-1", tenantId: null, role: Role.Teacher },
      "test-secret",
      { expiresIn: -1 },
    );

    expect(() => service.verify(expired)).toThrow(InvalidTokenError);
  });

  it("verify() throws InvalidTokenError when the payload is missing required fields", () => {
    const incomplete = jwt.sign({ sub: "user-1" }, "test-secret");

    expect(() => service.verify(incomplete)).toThrow(InvalidTokenError);
  });
});
