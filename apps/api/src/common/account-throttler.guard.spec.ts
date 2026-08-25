import { Role } from "@exams-generator/shared";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { JwtAuthGuard } from "../modules/auth/jwt-auth.guard";
import { AiController } from "../modules/ai/ai.controller";
import { AiJobsController } from "../modules/ai/ai-jobs.controller";
import {
  AccountThrottlerGuard,
  accountTrackerFor,
  AI_CROP_PER_ACCOUNT_THROTTLE,
} from "./account-throttler.guard";

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

describe("Important Finding 6: an account-scoped @Throttle override must never raise the global IP ceiling", () => {
  // `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])` (app.module.ts)
  // registers a single UNNAMED throttler, which the library treats as
  // "default". `@Throttle({ default: {...} })` metadata is read by BOTH
  // guards on this route — the global IP-based `ThrottlerGuard` (APP_GUARD)
  // AND the controller-level `AccountThrottlerGuard` — because `@Throttle`
  // metadata is guard-agnostic reflection, keyed only by throttler NAME, not
  // by which guard instance is asking. An account-scoped override therefore
  // silently becomes the IP-based limit too. Until the two guards get their
  // own named throttlers, the only safe account override is one that does
  // not exceed the global default.
  const GLOBAL_IP_LIMIT = 100;

  it("caps AI_CROP_PER_ACCOUNT_THROTTLE at or below the global IP limit", () => {
    expect(AI_CROP_PER_ACCOUNT_THROTTLE.default.limit).toBeLessThanOrEqual(GLOBAL_IP_LIMIT);
  });

  it("the crop route's actual @Throttle metadata (what the guards really read) does not exceed the global IP limit", () => {
    // Read the SAME reflection key `ThrottlerGuard.handleRequest` reads
    // (`THROTTLER:LIMIT` + throttler name — "default" here, since the
    // module registers an unnamed throttler). Asserting on the constant
    // above only proves the constant is small; this proves the decorator
    // actually applied it to the route handler the guards inspect.
    const limit = Reflect.getMetadata(
      "THROTTLER:LIMITdefault",
      AiController.prototype.recrop,
    ) as number;
    expect(limit).toBeLessThanOrEqual(GLOBAL_IP_LIMIT);
  });
});
