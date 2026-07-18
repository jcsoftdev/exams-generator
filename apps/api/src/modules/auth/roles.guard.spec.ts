import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@exams-generator/shared";
import { RolesGuard } from "./roles.guard";

function makeContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe("RolesGuard", () => {
  function makeGuard(requiredRoles: Role[] | undefined): { guard: RolesGuard; reflector: Reflector } {
    const reflector = new Reflector();
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(requiredRoles);
    return { guard: new RolesGuard(reflector), reflector };
  }

  it("allows the request when the route declares no @Roles()", () => {
    const { guard } = makeGuard(undefined);
    expect(guard.canActivate(makeContext({ role: Role.Teacher }))).toBe(true);
  });

  it("allows the request when the user's role is in the required list", () => {
    const { guard } = makeGuard([Role.PlatformAdmin, Role.SchoolAdmin]);
    expect(guard.canActivate(makeContext({ role: Role.SchoolAdmin }))).toBe(true);
  });

  it("throws ForbiddenException when the user's role is not in the required list", () => {
    const { guard } = makeGuard([Role.PlatformAdmin]);
    expect(() => guard.canActivate(makeContext({ role: Role.Teacher }))).toThrow(ForbiddenException);
  });

  it("throws UnauthorizedException when there is no authenticated user on the request", () => {
    const { guard } = makeGuard([Role.PlatformAdmin]);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(UnauthorizedException);
  });
});
