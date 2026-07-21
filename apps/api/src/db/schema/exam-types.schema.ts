import { integer, pgTable, text } from "drizzle-orm/pg-core";

/**
 * Seeded catalog table (never user-editable at runtime), mirroring
 * `grade_levels`'s pattern — deliberately NOT a Postgres enum, because a
 * Postgres enum can't be "seeded" (its values are baked into DDL via
 * `ALTER TYPE`) and this catalog is data-driven by design: adding a future
 * exam type that combines existing axes (`course_scope` x `week_scope`) is
 * meant to be a plain insert, zero code (design doc §3.9, §5).
 *
 * `code` is both the primary key and the value stored elsewhere — matches
 * `"manual" | "fastest" | "eta" | "eta_by_week"` string literals exactly, so
 * no separate id/translation layer is needed. `course_scope`
 * (`'none' | 'all' | 'selected'`) and `week_scope`
 * (`'none' | 'current_only' | 'cumulative'`) are the two axes that drive
 * how each exam type resolves its blueprint.
 */
export const examTypes = pgTable("exam_types", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  courseScope: text("course_scope").notNull(),
  weekScope: text("week_scope").notNull(),
  sortOrder: integer("sort_order").notNull().unique(),
});
