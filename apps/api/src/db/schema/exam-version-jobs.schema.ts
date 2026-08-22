import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { generationJobStatusEnum, roleEnum } from "./enums";
import { exams } from "./exams.schema";
import { tenants } from "./tenants.schema";
import { users } from "./users.schema";

/**
 * A durable PDF-version generation batch (audit P0: `POST
 * /exams/:id/versions` used to compile N PDFs synchronously inside the
 * request/response cycle, which is what forced both the `MAX_VERSION_COUNT`
 * cap and nginx's `proxy_read_timeout` override).
 *
 * Reuses `generation_job_status` rather than declaring a parallel enum — the
 * lifecycle is identical to `generation_jobs`' (pending -> running ->
 * completed/failed), and one enum keeps both queues' status vocabulary in
 * sync. `created_by_role` is stored for the same reason it is on
 * `generation_jobs`: the BullMQ worker has no HTTP request context and
 * rebuilds an `AuthTokenPayload` from this row alone.
 *
 * `completed_count` is the number of forms fully persisted so far, so a
 * partial failure stays TRUTHFUL: the job resolves to `failed` with
 * `completed_count < version_count` and a `failed_reason`, while the forms
 * that did generate remain downloadable. (Chosen over rollback: a failed
 * REgeneration would otherwise destroy the previous forms — `clearVersions`
 * already wiped them — and leave the exam with nothing at all.)
 */
export const examVersionJobs = pgTable(
  "exam_version_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdByRole: roleEnum("created_by_role").notNull(),
    versionCount: integer("version_count").notNull(),
    status: generationJobStatusEnum("status").notNull().default("pending"),
    completedCount: integer("completed_count").notNull().default(0),
    failedReason: text("failed_reason"),
    /**
     * The question the Typst compile failed on, when the adapter could trace
     * one (`ExamPdfGenerationError.questionId`). Deliberately NOT a foreign
     * key: it is diagnostic text for the UI ("falló en la pregunta X"), and a
     * job row must survive the question later being archived or deleted.
     */
    failedQuestionId: text("failed_question_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    examCreatedIdx: index("exam_version_jobs_exam_created_idx").on(table.examId, table.createdAt),
    tenantCreatedIdx: index("exam_version_jobs_tenant_created_idx").on(table.tenantId, table.createdAt),
    statusIdx: index("exam_version_jobs_status_idx").on(table.status),
  }),
);
