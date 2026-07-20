import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { courses } from "./courses.schema";
import { difficultyEnum, generationJobStatusEnum, roleEnum } from "./enums";
import { gradeLevels } from "./grade-levels.schema";
import { tenants } from "./tenants.schema";
import { topics } from "./topics.schema";
import { users } from "./users.schema";

/**
 * A durable AI-generation batch job (design doc §3). `created_by_role` is
 * stored because the BullMQ worker (`GenerationJobsProcessor`) has no HTTP
 * request context — it reconstructs an `AuthTokenPayload` from this row
 * alone to call `GenerateQuestionsService.generateQuestions()`.
 * `created_question_ids`/`failed_items` accumulate incrementally as the
 * worker processes each item — see `GenerationJobsRepository`.
 */
export const generationJobs = pgTable("generation_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdByRole: roleEnum("created_by_role").notNull(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id),
  topicId: uuid("topic_id")
    .notNull()
    .references(() => topics.id),
  difficulty: difficultyEnum("difficulty").notNull(),
  gradeLevel: text("grade_level")
    .notNull()
    .references(() => gradeLevels.code),
  count: integer("count").notNull(),
  withFigure: boolean("with_figure").notNull().default(false),
  status: generationJobStatusEnum("status").notNull().default("pending"),
  createdCount: integer("created_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  createdQuestionIds: jsonb("created_question_ids").notNull().default([]),
  failedItems: jsonb("failed_items").notNull().default([]),
  cancelRequested: boolean("cancel_requested").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
