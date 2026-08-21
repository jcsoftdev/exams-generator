import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { users } from "../../db/schema";

/**
 * How long a verified account's status is trusted without re-reading it.
 *
 * This IS the revocation window. `TOKEN_TTL` is 8h, so before this existed a
 * deactivated teacher kept working until their token expired — the whole
 * school day (audit 2026-08-20, H3). A minute keeps the promise the UI makes
 * ("Desactivar" takes effect now, near enough) while keeping the cost of the
 * check at roughly one read per user per minute rather than one per request.
 */
export const ACCOUNT_STATUS_TTL_MS = 60_000;

interface CachedStatus {
  readonly usable: boolean;
  readonly expiresAt: number;
}

/**
 * Answers "may this account still act?" for `JwtAuthGuard`, on every request.
 *
 * A signature-valid token is not enough: the account behind it may have been
 * deactivated or deleted since it was issued, and nothing in a JWT can know
 * that. Login already refuses an inactive account a NEW token; this is what
 * stops the OLD one.
 *
 * The cache is a plain Map, not Redis. Its key space is limited to user ids
 * that appear inside signature-valid tokens, so it cannot be flooded by an
 * attacker, and it is per-process — with several API instances each holds its
 * own answer, each at most `ACCOUNT_STATUS_TTL_MS` stale, which is the same
 * guarantee, not a weaker one. It also means an outright Redis outage cannot
 * take authentication down with it.
 */
@Injectable()
export class AccountStatusService {
  private readonly cache = new Map<string, CachedStatus>();

  async isUsable(userId: string): Promise<boolean> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.usable;
    }

    const [row] = await db.select({ active: users.active }).from(users).where(eq(users.id, userId));
    const usable = row?.active === true;

    this.cache.set(userId, { usable, expiresAt: Date.now() + ACCOUNT_STATUS_TTL_MS });
    return usable;
  }

  /**
   * Drops one account's cached answer so the next request re-reads it. Called
   * by the deactivation path: waiting out the TTL would be correct but reads
   * to an admin as if the button did nothing.
   */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }
}
