/**
 * `platform_admin`-only tenant CRUD models — `apps/api/src/modules/tenants/tenants.controller.ts`.
 * Distinct from `features/tenant-settings` (which is scoped to the
 * authenticated user's OWN tenant via `AuthService.currentTenantId()`);
 * this is the platform-wide "manage every school" screen.
 */
export interface AdminTenant {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly city: string | null;
  readonly logoAssetId: string | null;
  readonly active: boolean;
}

export interface PagedAdminTenants {
  readonly items: readonly AdminTenant[];
  readonly total: number;
}

export interface CreateTenantPayload {
  readonly name: string;
  readonly slug: string;
}

export interface UpdateTenantPayload {
  readonly name?: string;
  readonly city?: string;
  readonly active?: boolean;
}
