import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { AuthTokenPayload } from "../modules/auth/token.service";

/**
 * The tracker key for one request: the signed-in account when there is one,
 * otherwise `null` so the caller falls back to the IP.
 *
 * Split out of the guard because it is the whole decision, and instantiating a
 * `ThrottlerGuard` to test it would mean building storage, options and a
 * reflector to exercise one line.
 */
export function accountTrackerFor(request: { user?: AuthTokenPayload }): string | null {
  const sub = request.user?.sub;
  return typeof sub === "string" && sub.length > 0 ? `account:${sub}` : null;
}

/**
 * Rate limits by ACCOUNT instead of by IP.
 *
 * IP is the wrong unit for a school: the staff room sits behind one NAT, so
 * everybody shares a single bucket and one enthusiastic teacher locks their
 * colleagues out — while someone actually abusing the endpoint just tethers to
 * a phone and gets a fresh IP (audit 2026-08-20, M9). The account is what
 * spends the money on these routes, so it is what gets counted.
 *
 * MUST come AFTER `JwtAuthGuard` in `@UseGuards(...)`: guards run in order and
 * `request.user` only exists once the token is verified. If it ever runs
 * unauthenticated it falls back to `super.getTracker` (the IP), so a
 * misconfiguration costs the sharper limit rather than all limiting.
 */
/**
 * Per-account budget for the AI routes, on top of the global 100/min IP limit.
 *
 * 30 a minute is well past what a teacher does by hand — generating a question,
 * reading it, revising it — and far under what a script can do. It bounds the
 * blast radius of one compromised or careless account without ever being felt
 * by a real one.
 */
export const AI_PER_ACCOUNT_THROTTLE = { default: { ttl: 60_000, limit: 30 } };

/**
 * Crop adjustment calls no model: they re-cut an image already in Redis.
 * Inheriting `AI_PER_ACCOUNT_THROTTLE` (30/min, sized for paid model calls)
 * would let three crop adjustments eat a teacher's whole generation quota.
 *
 * Capped at 100 — the global per-IP ceiling (`app.module.ts`'s
 * `ThrottlerModule.forRoot`) — NOT the ~240 this route's cost alone would
 * justify. `@Throttle` metadata is guard-agnostic: it is read by BOTH the
 * global IP-based `ThrottlerGuard` (`APP_GUARD`) and this file's
 * `AccountThrottlerGuard`, since both share the same unnamed "default"
 * throttler config and the same reflected metadata key (Important
 * Finding 6). A higher account-scoped number here would silently relax the
 * IP-based ceiling too, on the branch's most CPU-expensive endpoint — it
 * decodes up to 5 MB and PNG-encodes a 1200px image per call. The
 * alternative fix (a separate NAMED throttler per guard, so the two stop
 * sharing decorator metadata) was rejected as the larger change for the same
 * outcome: it touches `ThrottlerModule.forRoot`'s config shape and every
 * existing `@Throttle({ default: ... })` call site across the app
 * (`AiController`, `AiJobsController`, `AuthController`), whereas capping
 * this one constant is a single-line fix with no wiring risk.
 */
export const AI_CROP_PER_ACCOUNT_THROTTLE = { default: { ttl: 60_000, limit: 100 } };

@Injectable()
export class AccountThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const tracker = accountTrackerFor(req as { user?: AuthTokenPayload });
    return tracker !== null ? Promise.resolve(tracker) : super.getTracker(req);
  }
}
