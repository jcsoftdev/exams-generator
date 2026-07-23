import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { assets } from "./assets.schema";
import { courses } from "./courses.schema";
import { cycles } from "./cycles.schema";
import { difficultyEnum, examStatusEnum } from "./enums";
import { examTypes } from "./exam-types.schema";
import { gradeLevels } from "./grade-levels.schema";
import { questions } from "./questions.schema";
import { tenants } from "./tenants.schema";
import { topics } from "./topics.schema";
import { tracks } from "./tracks.schema";
import { universities } from "./universities.schema";
import { users } from "./users.schema";

/**
 * An exam always belongs to a specific tenant (school) — never central.
 *
 * `examType`/`universityId`/`trackId`/`cycleId`/`weekNumber` are metadata
 * about HOW the blueprint was produced (design doc §4 "Columnas nuevas en
 * `exams`") — the actual blueprint content keeps living in
 * `exam_blueprint_rows`/`exam_questions`, unchanged. `examType` defaults to
 * `'manual'` and the other four stay nullable so every existing caller (every
 * row created before this migration, every test that doesn't pass them)
 * behaves exactly as before. `weekNumber` is a frozen snapshot of
 * `computeCurrentWeek()` at generation time — it is NEVER recomputed later
 * (design doc §3.3), unlike `cycles`' own current-week, which is always
 * derived live.
 */
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  examType: text("exam_type")
    .notNull()
    .default("manual")
    .references(() => examTypes.code),
  universityId: uuid("university_id").references(() => universities.id),
  trackId: uuid("track_id").references(() => tracks.id),
  cycleId: uuid("cycle_id").references(() => cycles.id),
  weekNumber: integer("week_number"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tenantCreatedIdx: index("exams_tenant_created_idx").on(table.tenantId, table.createdAt),
  tenantStatusIdx: index("exams_tenant_status_idx").on(table.tenantId, table.status),
}));

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
}, (table) => ({
  examIdIdx: index("exam_blueprint_rows_exam_id_idx").on(table.examId),
}));

/**
 * Final ordered question selection for an exam (shared across versions).
 *
 * `blueprint_row_id` links each selected question back to the exact
 * `exam_blueprint_rows` row it fulfilled. Necessary because rows are NOT
 * unique per criteria set (see `examBlueprintRows` docstring) — two rows can
 * share identical `{course, topic?, difficulty?}` while a third overlapping
 * row targets a narrower slice (e.g. row A = "5 aritmética", row B = "2
 * aritmética/hard"); a hard-aritmética question satisfies BOTH rows'
 * criteria, so without this link a "replace" operation couldn't reliably
 * know which row's (possibly narrower) criteria to preserve. Nullable only
 * so legacy/manual inserts remain valid; the exams module always sets it.
 */
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
    blueprintRowId: uuid("blueprint_row_id").references(() => examBlueprintRows.id),
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
    questionIdIdx: index("exam_questions_question_id_idx").on(table.questionId),
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
    pdfAssetIdIdx: index("exam_versions_pdf_asset_id_idx").on(table.pdfAssetId),
    answerSheetAssetIdIdx: index("exam_versions_answer_sheet_asset_id_idx").on(
      table.answerSheetAssetId,
    ),
  }),
);
