/**
 * GAP (documented, matches the `ai.models.ts`/bank "no catalog endpoint
 * yet" convention already used in this codebase): no `GET/PATCH /tenants/me`
 * endpoint exists on the backend yet. `apps/api/src/db/schema/tenants.schema.ts`
 * already has the `tenants` table with a nullable `logoAssetId` FK to
 * `assets`, but no controller/service exposes it over HTTP. This module is
 * the FRONTEND CONTRACT this screen is built against — wire the real
 * `/tenants/me` routes once the backend module ships; until then this
 * screen's specs mock `TenantSettingsService` directly (Strict TDD does not
 * require the live endpoint to exist for a component spec).
 */
export interface TenantSettings {
  readonly id: string;
  readonly name: string;
  readonly logoAssetId: string | null;
}

export interface UpdateTenantSettingsPayload {
  readonly name: string;
  readonly logo?: File;
}
