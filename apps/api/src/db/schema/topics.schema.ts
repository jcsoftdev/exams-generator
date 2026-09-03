import { sql } from "drizzle-orm";
import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { courses } from "./courses.schema";

/**
 * Global taxonomy (e.g. fracciones, ecuaciones): ONE row per curriculum
 * concept per course. The grades it is taught at live in `topic_grades`
 * (design doc 2026-09-03) — this table used to carry a `grade_level` column
 * and be unique by `(course_id, name, grade_level)`, which duplicated every
 * concept once per grade and multiplied selects, trees and seeded folders.
 */
export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id),
    name: text("name").notNull(),
    /**
     * Canonical slug (design doc: two-level topic taxonomy). NULL on legacy/
     * variant rows created on demand from raw syllabus labels before the
     * reconciliation pass (`reconcileLegacyTopics` in `db/seed.ts`) folds
     * them into their canonical counterpart and deletes them. A fully
     * reconciled catalog has no `slug IS NULL` row left for the stages the
     * canonical taxonomy covers (currently preuniversitario only).
     */
    slug: text("slug"),
  },
  (table) => ({
    /** One concept, one row. This is the rule the whole 0023 migration exists to establish. */
    courseIdNameIdx: uniqueIndex("topics_course_id_name_idx").on(table.courseId, table.name),
    /**
     * Partial rather than relying on Postgres' NULL-distinct behaviour: it says
     * out loud that only canonical rows (slug set) are deduped, and legacy rows
     * (slug NULL) are exempt by design, not by accident.
     */
    courseIdSlugIdx: uniqueIndex("topics_course_id_slug_idx")
      .on(table.courseId, table.slug)
      .where(sql`${table.slug} is not null`),
  }),
);
