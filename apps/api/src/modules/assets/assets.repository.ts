import { and, eq, isNull, or, SQL } from "drizzle-orm";
import { db } from "../../db/client";
import { assets } from "../../db/schema";

export interface AssetRecord {
  readonly id: string;
  readonly tenantId: string | null;
  readonly storageKey: string;
  readonly mime: string;
}

/**
 * Drizzle-backed persistence for the `assets` module. Kept as a thin class
 * (no repository port/interface), same convention as `BankRepository`.
 */
export class AssetsRepository {
  /**
   * Same tenant-visibility rule as `BankRepository.findQuestionById`
   * (design doc §3): `tenant_id IS NULL OR tenant_id = :current` — a
   * central (bank-wide) asset is visible to every tenant, a private one
   * only to its own tenant. `currentTenantId: null` (platform staff)
   * resolves to `tenant_id IS NULL` only.
   */
  async findAssetById(id: string, currentTenantId: string | null): Promise<AssetRecord | undefined> {
    const visibility: SQL = currentTenantId
      ? (or(isNull(assets.tenantId), eq(assets.tenantId, currentTenantId)) as SQL)
      : (isNull(assets.tenantId) as SQL);

    const [row] = await db
      .select({
        id: assets.id,
        tenantId: assets.tenantId,
        storageKey: assets.storageKey,
        mime: assets.mime,
      })
      .from(assets)
      .where(and(eq(assets.id, id), visibility));

    return row;
  }
}
