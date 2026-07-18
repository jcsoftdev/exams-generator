/**
 * Wired against the REAL backend (`apps/api/src/modules/tenants/tenants.controller.ts`):
 * `GET/PATCH /tenants/:id` + `POST /tenants/:id/logo`. There is no
 * `/tenants/me` — a prior iteration of this screen assumed one, but the
 * `TenantGuard` scopes every route by the `:id` param, so `TenantSettingsService`
 * resolves the id from `AuthService.currentTenantId()` (decoded JWT claim)
 * instead. Subset of the `tenants` table columns
 * (`apps/api/src/db/schema/tenants.schema.ts`) this screen needs.
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
