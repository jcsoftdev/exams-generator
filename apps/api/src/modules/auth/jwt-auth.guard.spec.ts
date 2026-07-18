import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Role } from "@exams-generator/shared";
import { extractBearerToken, JwtAuthGuard } from "./jwt-auth.guard";
import { TokenService } from "./token.service";

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

  it.each([undefined, "", "abc.def.ghi", "Basic abc", "Bearer "])(
    "returns null for %p",
    (header) => {
      expect(extractBearerToken(header)).toBeNull();
    },
  );
});

describe("JwtAuthGuard", () => {
  const tokenService = new TokenService("guard-secret");
  const guard = new JwtAuthGuard(tokenService);

  it("attaches request.user and returns true for a valid Bearer token", () => {
    const token = tokenService.sign({ sub: "u1", tenantId: "t1", role: Role.Teacher });
    const { context, request } = contextWithHeader(`Bearer ${token}`);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual({ sub: "u1", tenantId: "t1", role: Role.Teacher });
  });

  it("throws UnauthorizedException when the Authorization header is missing", () => {
    const { context } = contextWithHeader(undefined);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("throws UnauthorizedException for an invalid token", () => {
    const { context } = contextWithHeader("Bearer not-a-real-jwt");

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
