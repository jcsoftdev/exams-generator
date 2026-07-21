import { boolean, pgTable, text, uuid } from "drizzle-orm/pg-core";

/**
 * Global catalog, shared by every tenant — never tenant-scoped (same
 * reasoning as `courses`: a university like "uni" or "uncp" is not an
 * academy-owned concept, every tenant references the same fixed set of
 * rows). `code` is the stable identifier used to resolve blueprint
 * templates and tracks; `name` is the display label.
 */
export const universities = pgTable("universities", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
});
