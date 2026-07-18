import { integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.schema";

/**
 * `tenant_id NULL` = central/platform asset (e.g. images owned by the
 * shared question bank). Non-null = private to that tenant (e.g. a
 * school's logo or a tenant-private question image). Mirrors the same
 * nullable-FK visibility convention as `questions.tenant_id`.
 */
export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  storageKey: text("storage_key").notNull(),
  mime: text("mime").notNull(),
  width: integer("width"),
  height: integer("height"),
});
