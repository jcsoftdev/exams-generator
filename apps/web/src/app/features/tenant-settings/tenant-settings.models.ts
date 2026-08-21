import type { Tenant } from '@exams-generator/shared';

/**
 * Wired against the REAL backend (`apps/api/src/modules/tenants/tenants.controller.ts`):
 * `GET/PATCH /tenants/:id` + `POST /tenants/:id/logo`. There is no
 * `/tenants/me` — a prior iteration of this screen assumed one, but the
 * `TenantGuard` scopes every route by the `:id` param, so `TenantSettingsService`
 * resolves the id from `AuthService.currentTenantId()` (decoded JWT claim)
 * instead.
 *
 * `Tenant` (the full wire shape returned by every one of those endpoints)
 * comes from `@exams-generator/shared` — this is a `Pick`, not a second
 * declaration, because this screen genuinely never reads `slug`/`active`
 * (audit 2026-08-21, M4b; see `tenant.dto.ts` for the full field list).
 */
export type TenantSettings = Pick<Tenant, 'id' | 'name' | 'city' | 'logoAssetId'>;

export interface UpdateTenantSettingsPayload {
  readonly name: string;
  readonly city: string;
  readonly logo?: File;
}
