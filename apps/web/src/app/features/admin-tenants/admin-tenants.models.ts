/**
 * `platform_admin`-only tenant CRUD models — `apps/api/src/modules/tenants/tenants.controller.ts`.
 * Distinct from `features/tenant-settings` (which is scoped to the
 * authenticated user's OWN tenant via `AuthService.currentTenantId()`);
 * this is the platform-wide "manage every school" screen.
 *
 * The wire shapes come from `@exams-generator/shared`, which the API compiles
 * against too — re-exported here so this feature keeps its own local
 * imports. They used to be declared a second time on each side, with nothing
 * tying a field renamed on the wire to a compile failure on the client
 * (audit 2026-08-21, M4b).
 */
export type { CreateTenantPayload, DeleteTenantResult, Tenant as AdminTenant, TenantListResult as PagedAdminTenants, UpdateTenantPayload } from '@exams-generator/shared';
