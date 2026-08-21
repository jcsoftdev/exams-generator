/**
 * The wire shape of a tenant row — what `POST /tenants`, `GET /tenants/:id`,
 * `PATCH /tenants/:id` and `POST /tenants/:id/logo` all return, and one entry
 * of `GET /tenants`'s `items` array.
 *
 * Declared here rather than twice — it was `AdminTenant` in the web's
 * `admin-tenants.models.ts` (the `platform_admin` "every school" screen) and
 * a subset of the same shape, `TenantSettings`, in
 * `tenant-settings.models.ts` (the signed-in user's own-tenant screen), with
 * the API side typing every response as the bare Drizzle row
 * (`typeof tenants.$inferSelect`, inferred straight from
 * `apps/api/src/db/schema/tenants.schema.ts`) — nothing tied a column rename
 * on that schema to a compile failure on either web screen (audit
 * 2026-08-21, M4b).
 *
 * Comparing the two web declarations against the actual `tenants` table
 * turned up no field drift: `AdminTenant` already listed every column, and
 * `TenantSettings`'s narrower `{id, name, city, logoAssetId}` is a genuine
 * subset — the tenant-settings screen never reads `slug`/`active` (neither
 * is rendered there), so it keeps a `Pick<Tenant, ...>` instead of the full
 * shape.
 */
export interface Tenant {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly city: string | null;
  readonly logoAssetId: string | null;
  readonly active: boolean;
}

/** `GET /tenants` (`platform_admin`-only, N3) response. */
export interface TenantListResult {
  readonly items: readonly Tenant[];
  readonly total: number;
}

/** `POST /tenants` request body. */
export interface CreateTenantPayload {
  readonly name: string;
  readonly slug: string;
}

/** `PATCH /tenants/:id` request body — every field optional, sparse update. */
export interface UpdateTenantPayload {
  readonly name?: string;
  readonly city?: string;
  readonly active?: boolean;
}

/** `DELETE /tenants/:id` response. */
export interface DeleteTenantResult {
  readonly deleted: true;
}
