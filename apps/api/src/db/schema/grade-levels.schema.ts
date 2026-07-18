import { integer, pgTable, text } from "drizzle-orm/pg-core";

/**
 * Seeded catalog table (never user-editable at runtime). Rows are inserted
 * by `seed.ts` from the single source of truth `GRADE_LEVELS`
 * (`modules/exams/domain/value-objects/grade-level.ts`) — the 12 fixed
 * levels (1ro-6to primaria, 1ro-5to secundaria, pre) are never hardcoded a
 * second time here.
 *
 * `code` is both the primary key and the value stored on `questions` /
 * `exams` — matches `GradeLevel` string literals exactly (e.g.
 * `"primaria_1"`), so no separate id/translation layer is needed.
 */
export const gradeLevels = pgTable("grade_levels", {
  code: text("code").primaryKey(),
  sortOrder: integer("sort_order").notNull().unique(),
});
