import { Role } from "@exams-generator/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { examVersionJobs } from "../../db/schema";
import { GenerationJobStatus } from "../../db/schema/enums";

export interface CreateExamVersionJobRecord {
  readonly tenantId: string;
  readonly examId: string;
  readonly createdBy: string;
  readonly createdByRole: Role;
  readonly versionCount: number;
}

export interface ExamVersionJobFailure {
  readonly reason: string;
  /** `ExamPdfGenerationError.questionId` when the compiler could trace the failure to one question. */
  readonly questionId?: string;
}

export interface ExamVersionJobRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly examId: string;
  readonly createdBy: string;
  readonly createdByRole: Role;
  readonly versionCount: number;
  readonly status: GenerationJobStatus;
  readonly completedCount: number;
  readonly failedReason: string | null;
  readonly failedQuestionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

const TERMINAL_STATUSES: readonly GenerationJobStatus[] = ["completed", "failed", "cancelled"];

function toRecord(row: typeof examVersionJobs.$inferSelect): ExamVersionJobRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    examId: row.examId,
    createdBy: row.createdBy,
    createdByRole: row.createdByRole as Role,
    versionCount: row.versionCount,
    status: row.status,
    completedCount: row.completedCount,
    failedReason: row.failedReason,
    failedQuestionId: row.failedQuestionId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

/**
 * All `exam_version_jobs` queries. Same split as
 * `GenerationJobsRepository`: every method is tenant-scoped except
 * `getByIdUnscoped()`, which exists for `ExamVersionJobsProcessor` — a BullMQ
 * worker has no HTTP request context beyond what the row itself carries.
 */
export class ExamVersionJobsRepository {
  async create(record: CreateExamVersionJobRecord): Promise<ExamVersionJobRecord> {
    const [row] = await db.insert(examVersionJobs).values(record).returning();
    return toRecord(row!);
  }

  async getById(id: string, tenantId: string): Promise<ExamVersionJobRecord | undefined> {
    const [row] = await db
      .select()
      .from(examVersionJobs)
      .where(and(eq(examVersionJobs.id, id), eq(examVersionJobs.tenantId, tenantId)));
    return row ? toRecord(row) : undefined;
  }

  /** Tenant-unscoped lookup — worker-only, see the class docstring. */
  async getByIdUnscoped(id: string): Promise<ExamVersionJobRecord | undefined> {
    const [row] = await db.select().from(examVersionJobs).where(eq(examVersionJobs.id, id));
    return row ? toRecord(row) : undefined;
  }

  /**
   * Newest job for one exam. Lets the versions screen re-attach to an
   * in-flight generation after a page reload (the job id from the original
   * `POST` response is gone by then, but the exam id never is).
   */
  async getLatestForExam(examId: string, tenantId: string): Promise<ExamVersionJobRecord | undefined> {
    const [row] = await db
      .select()
      .from(examVersionJobs)
      .where(and(eq(examVersionJobs.examId, examId), eq(examVersionJobs.tenantId, tenantId)))
      .orderBy(desc(examVersionJobs.createdAt))
      .limit(1);
    return row ? toRecord(row) : undefined;
  }

  /**
   * Marks the job `running` and ZEROES the progress counter.
   *
   * Called at the top of every worker attempt, including BullMQ retries,
   * because version generation is deliberately NOT resumable: each attempt
   * starts with `clearVersions()`, which wipes the exam's forms and rebuilds
   * them from scratch (B4-B idempotent regeneration). Carrying the previous
   * attempt's `completed_count` forward — the way `GenerationJobsProcessor`
   * legitimately does, since IT resumes — would report progress for forms
   * that no longer exist. Any prior failure detail is cleared for the same
   * reason: it describes an attempt that has been thrown away.
   */
  async startAttempt(id: string): Promise<void> {
    await db
      .update(examVersionJobs)
      .set({
        status: "running",
        completedCount: 0,
        failedReason: null,
        failedQuestionId: null,
        updatedAt: new Date(),
      })
      .where(eq(examVersionJobs.id, id));
  }

  async setStatus(id: string, status: GenerationJobStatus): Promise<void> {
    await db
      .update(examVersionJobs)
      .set({
        status,
        updatedAt: new Date(),
        completedAt: TERMINAL_STATUSES.includes(status) ? new Date() : undefined,
      })
      .where(eq(examVersionJobs.id, id));
  }

  /** One statement (`completed_count + 1`), so progress is never a read-modify-write even though the worker is the only writer. */
  async incrementCompleted(id: string): Promise<void> {
    await db
      .update(examVersionJobs)
      .set({
        completedCount: sql`${examVersionJobs.completedCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(examVersionJobs.id, id));
  }

  /**
   * Resolves the job to `failed` WITHOUT touching `completed_count` — the
   * forms generated before the failure stay persisted and downloadable, and
   * the row reports exactly how far it got (see the schema docstring for why
   * partial-report beats rollback here).
   */
  async markFailed(id: string, failure: ExamVersionJobFailure): Promise<void> {
    await db
      .update(examVersionJobs)
      .set({
        status: "failed",
        failedReason: failure.reason,
        failedQuestionId: failure.questionId ?? null,
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(examVersionJobs.id, id));
  }
}
