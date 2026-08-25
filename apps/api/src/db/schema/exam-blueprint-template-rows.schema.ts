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
    /**
     * Canonical order of the row inside its template — the order in which the
     * university prints the blocks, and within a block, the order in which
     * the source lists the courses. Without this, the official order isn't
     * reproducible.
     */
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * The PRINTED block this row belongs to. This is NOT the course: the UNI
     * prints "MATEMÁTICA" as a single block of 40 questions that covers
     * Aritmética, Álgebra, Geometría and Trigonometría (spec §2.2). Several
     * rows of different courses share `block_code`.
     */
    blockCode: text("block_code"),
    blockLabel: text("block_label"),
    /**
     * OFFICIAL total question count for the block, when the university
     * publishes it (the UNI publishes "40 questions of Matemática" and
     * nothing else). It's the same value repeated across every row of the
     * block; it's repeated because the block has no table of its own and
     * doesn't deserve one for three rows.
     *
     * This is an INVARIANT, not an editable field: the academy can adjust how
     * it's split between courses, but the sum must still equal this number
     * (spec §3.9). `null` when the source doesn't publish a block total.
     */
    blockQuestionCount: integer("block_question_count"),
    /**
     * Readable label of the section/exam ("SEGUNDA PRUEBA — MATEMÁTICA").
     * `exam_section` already stored the code ("E2") and stops being purely
     * decorative.
     */
    sectionLabel: text("section_label"),
  },
  (table) => ({
    questionCountOrWeightPointsCheck: check(
      "exam_blueprint_template_rows_question_count_or_weight_points_check",
      sql`${table.questionCount} is not null or ${table.weightPoints} is not null`,
    ),
    templateIdIdx: index("exam_blueprint_template_rows_template_id_idx").on(table.templateId),
  }),
);
