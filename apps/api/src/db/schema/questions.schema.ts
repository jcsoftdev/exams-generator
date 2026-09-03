import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { assets } from "./assets.schema";
import { difficultyEnum, questionStatusEnum, questionTypeEnum } from "./enums";
import { gradeLevels } from "./grade-levels.schema";
import { questionFolders } from "./question-folders.schema";
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
    /**
     * The tenant folder this question is filed under. Only meaningful when
     * `tenant_id` is non-null: folders are per-tenant, so a CENTRAL question
     * can never carry one (the service rejects it with 422
     * `central_question_has_no_folder`) — it surfaces inside a folder through
     * that folder's `topic_id` instead. `ON DELETE SET NULL` is the whole point
     * of the delete flow: removing a folder unfiles its questions, it never
     * deletes one.
     */
    folderId: uuid("folder_id").references(() => questionFolders.id, { onDelete: "set null" }),
    difficulty: difficultyEnum("difficulty").notNull(),
    gradeLevel: text("grade_level")
      .notNull()
      .references(() => gradeLevels.code),
    status: questionStatusEnum("status").notNull().default("draft"),
    imageAssetId: uuid("image_asset_id").references(() => assets.id),
    bodyTypst: text("body_typst"),
    alternatives: jsonb("alternatives"),
    figureCode: text("figure_code"),
    /**
     * sha256 of `bodyTypst` (trimmed) — NULL for `type = 'image'` questions,
     * which have no `bodyTypst` to hash. Backs `questions_tenant_id_body_hash_idx`
     * so re-seeding or re-pasting the same statement into the same bank
     * (central or a tenant's own) is caught at insert time instead of
     * silently duplicating — see `hash-body-typst.ts`.
     */
    bodyHash: text("body_hash"),
    /**
     * Where a web-sourced question came from. NULL for anything authored in
     * the app (tenant banks, AI generation) — these only ever get filled by
     * the collected/*.json seeder.
     *
     * `sourceUrl` is load-bearing, not decorative: the central bank mixes
     * channels whose licensing differs (state exams published for public
     * preparation, CC-licensed material, exam boards that reserve rights).
     * Storing the URL is what makes "remove every question from host X" a
     * query instead of a re-derivation from the seed files.
     */
    sourceUrl: text("source_url"),
    sourceName: text("source_name"),
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
    folderIdIdx: index("questions_folder_id_idx").on(table.folderId),
    gradeLevelIdx: index("questions_grade_level_idx").on(table.gradeLevel),
    difficultyIdx: index("questions_difficulty_idx").on(table.difficulty),
    statusIdx: index("questions_status_idx").on(table.status),
    // Supports pulling a whole channel back out by host when its licensing
    // changes — the reason source_url is stored at all.
    sourceUrlIdx: index("questions_source_url_idx").on(table.sourceUrl),
    poolIdx: index("questions_pool_idx").on(table.gradeLevel, table.status),
    /**
     * The bank grid's index. `listQuestions` filters by `topic_id` (the tree
     * lazy-loads one topic at a time) and orders by `created_at DESC, id DESC`;
     * without this, Postgres sorted every row that passed the filter and threw
     * all but a `pageSize` window away (docs/audit-2026-08-26-prod-latency.md
     * §4.1). The asymmetry that made it easy to miss: `exams` got exactly this
     * treatment in 0011 (`exams_tenant_created_idx`) and `questions` — the
     * table with 64k rows rather than hundreds — did not.
     *
     * Declared ASCENDING on purpose, even though the query says DESC. A btree
     * scans backwards just as cheaply, and the direction only has to be spelled
     * out for MIXED orderings (`created_at DESC, id ASC`). Both keys here point
     * the same way, so `(topic_id, created_at, id)` serves
     * `ORDER BY created_at DESC, id DESC` exactly. Do not "fix" this by adding
     * `.desc()`.
     */
    topicCreatedIdx: index("questions_topic_created_idx").on(table.topicId, table.createdAt, table.id),
    // Multiple NULL body_hash rows (all `type = 'image'` questions) never
    // collide under Postgres' NULL-distinct unique-index semantics.
    tenantIdBodyHashIdx: uniqueIndex("questions_tenant_id_body_hash_idx").on(table.tenantId, table.bodyHash),
  }),
);
