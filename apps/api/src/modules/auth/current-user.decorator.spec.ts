import { ExecutionContext } from "@nestjs/common";
import { Role } from "@exams-generator/shared";
import { extractCurrentUser } from "./current-user.decorator";

function contextWithUser(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe("extractCurrentUser", () => {
  it("returns request.user when JwtAuthGuard already populated it", () => {
    const payload = { sub: "u1", tenantId: "t1", role: Role.Teacher };

    expect(extractCurrentUser(contextWithUser(payload))).toEqual(payload);
  });

  it("throws when request.user is missing (guard not applied)", () => {
    expect(() => extractCurrentUser(contextWithUser(undefined))).toThrow(
      /JwtAuthGuard/,
    );
  });
});
