import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { courses } from "./courses.schema";
import { gradeLevels } from "./grade-levels.schema";

/**
 * Global taxonomy (e.g. fracciones, ecuaciones), scoped to a course and,
 * optionally, to the grade level it is assessed at. `gradeLevel` NULL means
 * "applies to the whole stage" (used by preuniversitario, whose single grade
 * makes per-grade tagging redundant); a non-null value scopes the topic to one
 * grade so the exam builder shows only what that grade evaluates.
 */
export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id),
    name: text("name").notNull(),
    gradeLevel: text("grade_level").references(() => gradeLevels.code),
  },
  (table) => ({
    // Same topic name may recur across grades of one course, so grade is part of the key.
    courseIdNameGradeIdx: uniqueIndex("topics_course_id_name_grade_idx").on(
      table.courseId,
      table.name,
      table.gradeLevel,
    ),
  }),
);
