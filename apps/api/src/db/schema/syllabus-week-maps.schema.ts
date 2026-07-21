import { integer, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { courses } from "./courses.schema";
import { examBlueprintTemplates } from "./exam-blueprint-templates.schema";
import { topics } from "./topics.schema";

/**
 * Topic → week mapping, optional (exists for UNI's week-by-week syllabus,
 * not for UNCP today — design doc §4, §8). `eta_by_week` is only offered
 * for a given `template_id` if at least one row exists here; the resolver
 * checks `EXISTS` before enabling the option, no schema-level flag needed.
 *
 * `(template_id, topic_id)` is unique: one week per topic per template.
 * `week_number` is 0-based ("Semana 00" in UNI's source material).
 */
export const syllabusWeekMaps = pgTable(
  "syllabus_week_maps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => examBlueprintTemplates.id),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id),
    weekNumber: integer("week_number").notNull(),
  },
  (table) => ({
    templateIdTopicIdIdx: uniqueIndex("syllabus_week_maps_template_id_topic_id_idx").on(
      table.templateId,
      table.topicId,
    ),
  }),
);
