import { check, index, integer, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { courses } from "./courses.schema";
import { examBlueprintTemplates } from "./exam-blueprint-templates.schema";
import { topics } from "./topics.schema";

/**
 * Course/topic/weight rows inside one `exam_blueprint_templates` row — the
 * actual blueprint content the generic resolver (design doc §5) filters by
 * `course_scope`/`week_scope` to build a `BlueprintRow[]`.
 *
 * `topic_id` is nullable for the same reason `exam_blueprint_rows.topic_id`
 * is: a source may only specify course-level weight, not per-topic.
 *
 * `question_count` and `weight_points` are two alternative "how much of this
 * exam" signals depending on the source institution: UNCP gives a real
 * question count, UNI only gives a points value (E1/E2/E3). Exactly one of
 * the two must be present, hence the CHECK — `check()` is natively supported
 * by the installed drizzle-orm (^0.33.0, see `pg-core/checks.ts`), so this
 * is expressed directly in the schema builder rather than as a follow-up
 * manual migration statement.
 *
 * `exam_section` and `source_level` are both nullable, free-text, purely
 * descriptive passthrough columns (design doc §4): `exam_section` labels
 * where this row came from ("E1"/"E2"/"E3" or "área curricular"),
 * `source_level` carries the raw NIVEL string (P.B./P.I./P.A.) before
 * `resolveDifficultyFromSourceLevel()` (§3.6) maps it — never mapped here.
 */
export const examBlueprintTemplateRows = pgTable(
  "exam_blueprint_template_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => examBlueprintTemplates.id),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id),
    topicId: uuid("topic_id").references(() => topics.id),
    questionCount: integer("question_count"),
    weightPoints: numeric("weight_points"),
    examSection: text("exam_section"),
    sourceLevel: text("source_level"),
  },
  (table) => ({
    questionCountOrWeightPointsCheck: check(
      "exam_blueprint_template_rows_question_count_or_weight_points_check",
      sql`${table.questionCount} is not null or ${table.weightPoints} is not null`,
    ),
    templateIdIdx: index("exam_blueprint_template_rows_template_id_idx").on(table.templateId),
  }),
);
