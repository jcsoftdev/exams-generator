import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { courses } from "./courses.schema";

/** Global taxonomy (e.g. fracciones, ecuaciones), scoped to a course. */
export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id),
    name: text("name").notNull(),
  },
  (table) => ({
    courseIdNameIdx: uniqueIndex("topics_course_id_name_idx").on(table.courseId, table.name),
  }),
);
