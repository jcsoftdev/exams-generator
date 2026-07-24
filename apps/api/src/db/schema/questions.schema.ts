import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { assets } from "./assets.schema";
import { difficultyEnum, questionStatusEnum, questionTypeEnum } from "./enums";
import { gradeLevels } from "./grade-levels.schema";
import { subtopics } from "./subtopics.schema";
import { tenants } from "./tenants.schema";
import { topics } from "./topics.schema";
import { users } from "./users.schema";

/**
 * `tenant_id NULL` = central/platform bank, visible to every tenant.
 * Non-null = private to that tenant. Visibility filtering
 * (`tenant_id IS NULL OR tenant_id = :current`) is applied by the bank
 * module's repository layer (PR6+) — out of scope here. This schema only
 * provides the nullable FK plus an index shaped for that access pattern
 * (Postgres can combine the `IS NULL` and `= :current` branches via a
 * bitmap OR over the same btree index).
 *
 * `grade_level` and `difficulty` are independent axes: exactly one grade
 * level and one difficulty (relative to that grade) per question — no
 * cross-grade ranking, no N:M relation. See `grade-level.spec.ts` in the
 * exams domain for the independence property this schema must not violate.
 *
 * MVP (Fase 1) only populates `type = 'image'`: the full statement +
 * alternatives are baked into `image_asset_id`; only the answer key
 * (`correct_answer`) is stored separately, and alternatives are never
 * shuffled for image questions (impossible by format). `body_typst` /
 * `alternatives` / `figure_code` back the `type = 'structured'` variant
 * introduced in Fase 2 and stay NULL until then.
 */
export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    type: questionTypeEnum("type").notNull().default("image"),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id),
    /**
     * Fine-grained classification (nullable — not every question is
     * subtopic-tagged yet). `topicId` above stays the denormalized coarse
     * parent so existing topic-scoped queries keep working unchanged.
     */
    subtopicId: uuid("subtopic_id").references(() => subtopics.id),
    difficulty: difficultyEnum("difficulty").notNull(),
    gradeLevel: text("grade_level")
      .notNull()
      .references(() => gradeLevels.code),
    status: questionStatusEnum("status").notNull().default("draft"),
    imageAssetId: uuid("image_asset_id").references(() => assets.id),
    bodyTypst: text("body_typst"),
    alternatives: jsonb("alternatives"),
    figureCode: text("figure_code"),
    correctAnswer: text("correct_answer").notNull(),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdIdx: index("questions_tenant_id_idx").on(table.tenantId),
    topicIdIdx: index("questions_topic_id_idx").on(table.topicId),
    subtopicIdIdx: index("questions_subtopic_id_idx").on(table.subtopicId),
    gradeLevelIdx: index("questions_grade_level_idx").on(table.gradeLevel),
    difficultyIdx: index("questions_difficulty_idx").on(table.difficulty),
    statusIdx: index("questions_status_idx").on(table.status),
    poolIdx: index("questions_pool_idx").on(table.gradeLevel, table.status),
  }),
);
