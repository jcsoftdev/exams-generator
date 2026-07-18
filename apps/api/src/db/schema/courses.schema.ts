import { pgTable, text, uuid } from "drizzle-orm/pg-core";

/**
 * Global taxonomy, shared by every tenant (e.g. Aritmética, Álgebra,
 * Razonamiento Matemático, Razonamiento Verbal) — never tenant-scoped.
 */
export const courses = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
});
