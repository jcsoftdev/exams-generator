import { Inject, Injectable } from "@nestjs/common";
import { FeatureFlag, isFeatureFlag } from "@exams-generator/shared";
import { and, eq } from "drizzle-orm";
import { Database, DRIZZLE_DB } from "../../db/client";
import { platformFeatureFlags, tenantFeatureFlags } from "../../db/schema";

/** One stored platform row, for the superadmin's own screen. */
export interface PlatformFlagRow {
  readonly key: FeatureFlag;
  readonly enabled: boolean;
  readonly updatedAt: Date;
}

/**
 * Drizzle access to the two flag tables. Deliberately thin: every rule about
 * what an absent row MEANS lives in `resolve-feature-flags.ts`, so that the
 * rule is testable without a database.
 */
@Injectable()
export class FeatureFlagsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  /**
   * Rows only. A key with no row is simply missing from the map — the
   * resolver, not this method, decides that means "not cut".
   *
   * Rows whose key has left the catalog are dropped here as well as in the
   * resolver: keeping them out of the map means nothing downstream has to
   * carry a `string` that pretends to be a `FeatureFlag`.
   */
  async readPlatform(): Promise<Map<FeatureFlag, boolean>> {
    const rows = await this.db
      .select({ key: platformFeatureFlags.key, enabled: platformFeatureFlags.enabled })
      .from(platformFeatureFlags);

    return toFlagMap(rows);
  }

  async readTenant(tenantId: string): Promise<Map<FeatureFlag, boolean>> {
    const rows = await this.db
      .select({ key: tenantFeatureFlags.key, enabled: tenantFeatureFlags.enabled })
      .from(tenantFeatureFlags)
      .where(eq(tenantFeatureFlags.tenantId, tenantId));

    return toFlagMap(rows);
  }

  /** Includes `updatedAt`, which the resolver has no use for but the admin screen does. */
  async listPlatformRows(): Promise<PlatformFlagRow[]> {
    const rows = await this.db
      .select({
        key: platformFeatureFlags.key,
        enabled: platformFeatureFlags.enabled,
        updatedAt: platformFeatureFlags.updatedAt,
      })
      .from(platformFeatureFlags);

    return rows.filter((row): row is PlatformFlagRow => isFeatureFlag(row.key));
  }

  async setPlatform(key: FeatureFlag, enabled: boolean, updatedBy: string): Promise<void> {
    await this.db
      .insert(platformFeatureFlags)
      .values({ key, enabled, updatedBy, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: platformFeatureFlags.key,
        set: { enabled, updatedBy, updatedAt: new Date() },
      });
  }

  async setTenant(tenantId: string, key: FeatureFlag, enabled: boolean, updatedBy: string): Promise<void> {
    await this.db
      .insert(tenantFeatureFlags)
      .values({ tenantId, key, enabled, updatedBy, updatedAt: new Date() })
      .onConflictDoUpdate({
        // The plain `(tenant_id, key)` unique constraint — no NULLS NOT
        // DISTINCT arbiter to reason about, which is what the two-table
        // split bought.
        target: [tenantFeatureFlags.tenantId, tenantFeatureFlags.key],
        set: { enabled, updatedBy, updatedAt: new Date() },
      });
  }

  /**
   * Drops an override so the tenant follows the catalog default again.
   * Distinct from writing the default's current value: if the default ever
   * changes, a tenant with no row follows it and a tenant that decided
   * otherwise does not.
   */
  async clearTenant(tenantId: string, key: FeatureFlag): Promise<void> {
    await this.db
      .delete(tenantFeatureFlags)
      .where(and(eq(tenantFeatureFlags.tenantId, tenantId), eq(tenantFeatureFlags.key, key)));
  }
}

function toFlagMap(rows: readonly { key: string; enabled: boolean }[]): Map<FeatureFlag, boolean> {
  const map = new Map<FeatureFlag, boolean>();
  for (const row of rows) {
    if (isFeatureFlag(row.key)) {
      map.set(row.key, row.enabled);
    }
  }
  return map;
}
