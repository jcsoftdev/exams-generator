import { Role } from "@exams-generator/shared";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { JwtAuthGuard } from "../modules/auth/jwt-auth.guard";
import { AiController } from "../modules/ai/ai.controller";
import { AiJobsController } from "../modules/ai/ai-jobs.controller";
import { AccountThrottlerGuard, accountTrackerFor } from "./account-throttler.guard";

describe("accountTrackerFor", () => {
  it("counts against the signed-in account", () => {
    // Audit 2026-08-20 M9: a whole school shares one IP, so the IP bucket
    // punishes colleagues and misses the abuser.
    expect(accountTrackerFor({ user: { sub: "user-1", tenantId: "t1", role: Role.Teacher } })).toBe(
      "account:user-1",
    );
  });

  it("returns null when there is no user, so the caller can fall back to the IP", () => {
    expect(accountTrackerFor({})).toBeNull();
    expect(accountTrackerFor({ user: undefined })).toBeNull();
  });

  it("treats an empty sub as no user rather than keying everyone together", () => {
    expect(accountTrackerFor({ user: { sub: "", tenantId: null, role: Role.Teacher } })).toBeNull();
  });
});

describe("guard order on the AI controllers", () => {
  // The whole fix rests on this order: the throttler reads `request.user`, which
  // JwtAuthGuard sets. Reversed, it silently degrades to IP limiting again and
  // no test of behaviour would notice, because the throttler is skipped under
  // NODE_ENV=test.
  it.each([
    ["AiController", AiController],
    ["AiJobsController", AiJobsController],
  ])("verifies the token before counting the request on %s", (_name, controller) => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[];

    expect(guards.indexOf(JwtAuthGuard)).toBeGreaterThanOrEqual(0);
    expect(guards.indexOf(AccountThrottlerGuard)).toBeGreaterThan(guards.indexOf(JwtAuthGuard));
  });
});
