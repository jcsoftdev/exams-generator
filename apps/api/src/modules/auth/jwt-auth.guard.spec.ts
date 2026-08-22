import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Role } from "@exams-generator/shared";
import { AccountStatusService } from "./account-status.service";
import { extractBearerToken, JwtAuthGuard } from "./jwt-auth.guard";
import { TokenService } from "./token.service";

/** Stands in for the DB-backed service; its own spec covers the real lookup and cache. */
function accountStatusReturning(usable: boolean): AccountStatusService {
  return { isUsable: () => Promise.resolve(usable), invalidate: () => {} } as unknown as AccountStatusService;
}

function contextWithHeader(header: string | undefined): {
  context: ExecutionContext;
  request: { headers: Record<string, string | undefined>; user?: unknown };
} {
  const request: { headers: Record<string, string | undefined>; user?: unknown } = {
    headers: { authorization: header },
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe("extractBearerToken", () => {
  it("returns the token from a well-formed Bearer header", () => {
    expect(extractBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it.each([undefined, "", "abc.def.ghi", "Basic abc", "Bearer "])("returns null for %p", (header) => {
    expect(extractBearerToken(header)).toBeNull();
  });
});

describe("JwtAuthGuard", () => {
  const tokenService = new TokenService("guard-secret");
  const guard = new JwtAuthGuard(tokenService, accountStatusReturning(true));

  it("attaches request.user and returns true for a valid Bearer token", async () => {
    const token = tokenService.sign({ sub: "u1", tenantId: "t1", role: Role.Teacher });
    const { context, request } = contextWithHeader(`Bearer ${token}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ sub: "u1", tenantId: "t1", role: Role.Teacher });
  });

  it("throws UnauthorizedException when the Authorization header is missing", async () => {
    const { context } = contextWithHeader(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("throws UnauthorizedException for an invalid token", async () => {
    const { context } = contextWithHeader("Bearer not-a-real-jwt");

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a signature-valid token whose account is deactivated or gone", async () => {
    // Audit 2026-08-20 H3: the token stayed good for the rest of the 8h TTL.
    const revoked = new JwtAuthGuard(tokenService, accountStatusReturning(false));
    const token = tokenService.sign({ sub: "u1", tenantId: "t1", role: Role.Teacher });
    const { context, request } = contextWithHeader(`Bearer ${token}`);

    await expect(revoked.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(request.user).toBeUndefined();
  });
});
