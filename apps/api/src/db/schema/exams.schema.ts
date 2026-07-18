import { integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { assets } from "./assets.schema";
import { courses } from "./courses.schema";
import { difficultyEnum, examStatusEnum } from "./enums";
import { gradeLevels } from "./grade-levels.schema";
import { questions } from "./questions.schema";
import { tenants } from "./tenants.schema";
import { topics } from "./topics.schema";
import { users } from "./users.schema";

/** An exam always belongs to a specific tenant (school) — never central. */
export const exams = pgTable("exams", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  title: text("title").notNull(),
  gradeLevel: text("grade_level")
    .notNull()
    .references(() => gradeLevels.code),
  status: examStatusEnum("status").notNull().default("draft"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
});

/**
 * One blueprint row: "N questions of {course, topic?, difficulty?}".
 * `topic_id` / `difficulty` are optional (a row may target an entire
 * course at any difficulty) — mirrors `BlueprintRow` in the domain
 * (`modules/exams/domain/blueprint-selector.ts`). Rows are NOT unique per
 * criteria set — two rows may share the same course/topic/difficulty with
 * different counts, and each is filled independently without reusing a
 * question across rows (domain-level rule, not a DB constraint).
 */
export const examBlueprintRows = pgTable("exam_blueprint_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  examId: uuid("exam_id")
    .notNull()
    .references(() => exams.id),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id),
  topicId: uuid("topic_id").references(() => topics.id),
  difficulty: difficultyEnum("difficulty"),
  count: integer("count").notNull(),
});

/** Final ordered question selection for an exam (shared across versions). */
export const examQuestions = pgTable(
  "exam_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id),
    position: integer("position").notNull(),
  },
  (table) => ({
    examIdQuestionIdIdx: uniqueIndex("exam_questions_exam_id_question_id_idx").on(
      table.examId,
      table.questionId,
    ),
    examIdPositionIdx: uniqueIndex("exam_questions_exam_id_position_idx").on(
      table.examId,
      table.position,
    ),
  }),
);

/**
 * One shuffled version (Forma A/B/C...) of an exam. `question_order` /
 * `alternative_orders` are the permutations applied on top of
 * `exam_questions`; `answer_key` is calculated AFTER shuffling — see the
 * property this must satisfy in `version-shuffler.spec.ts` (the key always
 * points at the correct alternative post-permutation).
 */
export const examVersions = pgTable(
  "exam_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id),
    code: text("code").notNull(),
    questionOrder: jsonb("question_order").notNull(),
    alternativeOrders: jsonb("alternative_orders"),
    answerKey: jsonb("answer_key").notNull(),
    pdfAssetId: uuid("pdf_asset_id").references(() => assets.id),
    answerSheetAssetId: uuid("answer_sheet_asset_id").references(() => assets.id),
  },
  (table) => ({
    examIdCodeIdx: uniqueIndex("exam_versions_exam_id_code_idx").on(table.examId, table.code),
  }),
);
