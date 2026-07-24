import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { topics } from "./topics.schema";

/**
 * Fine-grained taxonomy under a canonical `topics` row (design doc:
 * two-level topic taxonomy). `topics` stays coarse/week-level and drives
 * `syllabus_week_maps`; `subtopics` is what `questions.subtopic_id`
 * classifies against, so the question bank can be sliced more finely than
 * the week-level syllabus without fragmenting the shared `topics` catalog.
 */
export const subtopics = pgTable(
  "subtopics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
  },
  (table) => ({
    topicIdSlugIdx: uniqueIndex("subtopics_topic_id_slug_idx").on(table.topicId, table.slug),
    topicIdIdx: index("subtopics_topic_id_idx").on(table.topicId),
  }),
);
