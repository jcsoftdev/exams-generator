import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Global taxonomy, shared by every tenant — never tenant-scoped. Divided by
 * educational `stage` (escuela | colegio | preuniversitario): a course belongs
 * to exactly one stage, so the same subject name may appear once per stage
 * (e.g. "Matemática" in escuela AND colegio are distinct rows with distinct
 * topic sets). Uniqueness is therefore `(stage, name)`, not `name` alone.
 */
export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // Defaulted so ad-hoc test fixtures need not declare a stage; the real seed
    // always sets it explicitly per stage.
    stage: text("stage").notNull().default("preuniversitario"),
  },
  (table) => ({
    stageNameIdx: uniqueIndex("courses_stage_name_idx").on(table.stage, table.name),
  }),
);
