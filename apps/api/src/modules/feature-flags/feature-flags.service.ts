import { Injectable } from "@nestjs/common";
import {
  FEATURE_FLAG_DEFAULTS,
  FEATURE_FLAG_KEYS,
  FeatureFlag,
  FeatureFlagsDto,
  PlatformFeatureFlagDto,
  TenantFeatureFlagStateDto,
} from "@exams-generator/shared";
import { FeatureFlagsRepository } from "./feature-flags.repository";
import { resolveFeatureFlag, resolveFeatureFlags } from "./domain/resolve-feature-flags";

/**
 * How long a resolved layer is trusted without re-reading it. Same value and
 * same reasoning as `ACCOUNT_STATUS_TTL_MS`: it bounds how long a switch the
 * superadmin just moved can still be ignored, while keeping the cost at
 * roughly one read per tenant per minute instead of one per request.
 */
export const FEATURE_FLAGS_TTL_MS = 60_000;

interface CachedLayer {
  readonly flags: Map<FeatureFlag, boolean>;
  readonly expiresAt: number;
}

/**
 * Answers "is this feature on for this caller?" for the guard, the bank's
 * visibility scope and `GET /auth/me`.
 *
 * A plain singleton with an in-memory Map, NOT a request-scoped provider.
 * Request scope would bubble out to every consumer that injects this — the
 * guard, `BankService`, `ExamsService` — and `BankService` holds a preview
 * cache that would then be rebuilt per request. It also would not be
 * reachable at all from the BullMQ processors, which run in this same
 * process with no request behind them and still need to know whether a
 * tenant may print its own logo.
 *
 * With several API instances each holds its own answer, each at most
 * `FEATURE_FLAGS_TTL_MS` stale. `invalidate*` is therefore best-effort
 * across instances and exact within one — the TTL is what actually bounds
 * the window.
 */
@Injectable()
export class FeatureFlagsService {
  private platform: CachedLayer | null = null;
  private readonly tenants = new Map<string, CachedLayer>();

  constructor(private readonly repository: FeatureFlagsRepository) {}

  /**
   * Every flag's effective value for one caller. `tenantId` is `null` for
   * platform staff, which resolves against the kill switch alone.
   */
  async getEffective(tenantId: string | null): Promise<FeatureFlagsDto> {
    return resolveFeatureFlags({
      platform: await this.platformLayer(),
      tenant: tenantId === null ? null : await this.tenantLayer(tenantId),
    });
  }

  /** One flag, for the guard and for the bank's visibility scope. */
  async isEnabled(key: FeatureFlag, tenantId: string | null): Promise<boolean> {
    return resolveFeatureFlag(key, {
      platform: await this.platformLayer(),
      tenant: tenantId === null ? null : await this.tenantLayer(tenantId),
    });
  }

  /** `GET /feature-flags/platform` — the catalog with each key's kill-switch state. */
  async listPlatform(): Promise<PlatformFeatureFlagDto[]> {
    const rows = await this.repository.listPlatformRows();
    const byKey = new Map(rows.map((row) => [row.key, row]));

    return FEATURE_FLAG_KEYS.map((key) => {
      const row = byKey.get(key);
      return {
        key,
        // No row means nobody cut it. Reporting that as `true` rather than
        // as "unset" keeps the screen honest: what the admin sees is what
        // the guard will do.
        enabled: row?.enabled ?? true,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }

  /**
   * `GET /tenants/:id/feature-flags` — the three values kept apart, which is
   * what makes "I switched it on and the school still gets a 403"
   * explainable instead of a mystery.
   */
  async listForTenant(tenantId: string): Promise<TenantFeatureFlagStateDto[]> {
    const platform = await this.platformLayer();
    const tenant = await this.tenantLayer(tenantId);

    return FEATURE_FLAG_KEYS.map((key) => ({
      key,
      platform: platform.get(key) ?? true,
      tenant: tenant.get(key) ?? null,
      defaultEnabled: FEATURE_FLAG_DEFAULTS[key],
      effective: resolveFeatureFlag(key, { platform, tenant }),
    }));
  }

  async setPlatform(key: FeatureFlag, enabled: boolean, updatedBy: string): Promise<void> {
    await this.repository.setPlatform(key, enabled, updatedBy);
    this.platform = null;
  }

  async setForTenant(tenantId: string, key: FeatureFlag, enabled: boolean, updatedBy: string): Promise<void> {
    await this.repository.setTenant(tenantId, key, enabled, updatedBy);
    this.tenants.delete(tenantId);
  }

  async clearForTenant(tenantId: string, key: FeatureFlag): Promise<void> {
    await this.repository.clearTenant(tenantId, key);
    this.tenants.delete(tenantId);
  }

  private async platformLayer(): Promise<Map<FeatureFlag, boolean>> {
    if (this.platform && this.platform.expiresAt > Date.now()) {
      return this.platform.flags;
    }

    const flags = await this.repository.readPlatform();
    this.platform = { flags, expiresAt: Date.now() + FEATURE_FLAGS_TTL_MS };
    return flags;
  }

  private async tenantLayer(tenantId: string): Promise<Map<FeatureFlag, boolean>> {
    const cached = this.tenants.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.flags;
    }

    const flags = await this.repository.readTenant(tenantId);
    this.tenants.set(tenantId, { flags, expiresAt: Date.now() + FEATURE_FLAGS_TTL_MS });
    return flags;
  }
}
