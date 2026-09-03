import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { assets } from "./assets.schema";

/**
 * `logo_asset_id` and `assets.tenant_id` form a two-way FK: a tenant's logo
 * lives in `assets`, and an asset can belong to a tenant. Both columns are
 * nullable, so insertion order is never blocked (create the tenant with no
 * logo, upload the asset referencing the tenant, then set
 * `logo_asset_id`). The lazy `(): AnyPgColumn => assets.id` callback is
 * Drizzle's documented pattern for resolving this circular reference
 * between two schema files.
 */
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  city: text("city"),
  logoAssetId: uuid("logo_asset_id").references((): AnyPgColumn => assets.id),
  active: boolean("active").notNull().default(true),
  /**
   * Set the first time this tenant's default folder set is seeded
   * (`BankFoldersService.getTree`). NULL means "never seeded". Without this
   * marker, a tenant that deletes every folder on purpose would silently get
   * the whole default set back on the next page load.
   */
  foldersSeededAt: timestamp("folders_seeded_at", { withTimezone: true }),
});
