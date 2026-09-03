import { index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { gradeLevels } from "./grade-levels.schema";
import { topics } from "./topics.schema";

/**
 * The grades a topic is taught at. Replaces `topics.grade_level`, which forced
 * one ROW per grade and made a single curriculum concept ("Fracciones,
 * decimales y porcentajes") exist twice — 953 rows for 626 names, and ~510
 * duplicate folders per school (audit 2026-09-03).
 *
 * This is the taxonomy axis only. `questions.grade_level` and
 * `generation_jobs.grade_level` are NOT derived from it and do not change: a
 * question carries the grade it was written for, which is allowed to differ
 * from the grades its topic is taught at (86 of 67,029 rows already do).
 *
 * A topic with NO rows here is taught across its whole stage. That state does
 * not exist today — the migration writes at least one row for every topic that
 * had a grade — but the readers (`EXISTS (topic_grades …)`) treat it as
 * "matches no grade filter", which is the conservative reading.
 *
 * `ON DELETE CASCADE` on `topic_id`: retiring a topic must not leave orphan
 * grade rows behind. `grade_level` references the seeded `grade_levels`
 * catalog, same as `questions.grade_level`.
 */
export const topicGrades = pgTable(
  "topic_grades",
  {
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    gradeLevel: text("grade_level")
      .notNull()
      .references(() => gradeLevels.code),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.topicId, table.gradeLevel] }),
    /** `GET /topics?gradeLevel=` filters on this side, across every course. */
    gradeLevelIdx: index("topic_grades_grade_level_idx").on(table.gradeLevel),
  }),
);
