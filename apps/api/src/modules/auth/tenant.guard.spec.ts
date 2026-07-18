import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@exams-generator/shared";
import { TenantGuard } from "./tenant.guard";

function makeContext(user: unknown, params: Record<string, string> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, params }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe("TenantGuard", () => {
  function makeGuard(tenantParamName: string | undefined): { guard: TenantGuard } {
    const reflector = new Reflector();
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(tenantParamName);
    return { guard: new TenantGuard(reflector) };
  }

  it("bypasses scoping for platform_admin with a null tenantId (global access)", () => {
    const { guard } = makeGuard(undefined);
    const context = makeContext({ role: Role.PlatformAdmin, tenantId: null }, { id: "some-other-tenant" });
    expect(guard.canActivate(context)).toBe(true);
  });

  it("bypasses scoping for content_editor with a null tenantId (global access)", () => {
    const { guard } = makeGuard(undefined);
    const context = makeContext({ role: Role.ContentEditor, tenantId: null }, { id: "some-other-tenant" });
    expect(guard.canActivate(context)).toBe(true);
  });

  it("allows a school_admin when the target tenant matches the JWT tenantId", () => {
    const { guard } = makeGuard(undefined);
    const context = makeContext({ role: Role.SchoolAdmin, tenantId: "tenant-a" }, { id: "tenant-a" });
    expect(guard.canActivate(context)).toBe(true);
  });

  it("throws ForbiddenException when the target tenant does not match the JWT tenantId", () => {
    const { guard } = makeGuard(undefined);
    const context = makeContext({ role: Role.SchoolAdmin, tenantId: "tenant-a" }, { id: "tenant-b" });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it("reads the param name declared via @TenantParam() instead of the 'id' default", () => {
    const { guard } = makeGuard("tenantId");
    const context = makeContext(
      { role: Role.Teacher, tenantId: "tenant-a" },
      { tenantId: "tenant-a", id: "unrelated" },
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it("throws UnauthorizedException when there is no authenticated user on the request", () => {
    const { guard } = makeGuard(undefined);
    const context = makeContext(undefined, { id: "tenant-a" });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
