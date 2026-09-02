import { Difficulty, Role } from "@exams-generator/shared";
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { courses, generationJobs, topics } from "../../db/schema";
import { GenerationJobStatus } from "../../db/schema/enums";

export interface CreateGenerationJobRecord {
  readonly tenantId: string;
  readonly createdBy: string;
  readonly createdByRole: Role;
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly count: number;
  readonly withFigure: boolean;
  /** Immediate predecessor this job resubmits — set only when this row was created via `GenerationJobsService.create()`'s retry path. */
  readonly retriedFromJobId?: string;
  /** The chain's original job id (never this row's own id) — same value for every attempt in a chain, letting `list()`/`listChain()` find the whole chain in one filter. */
  readonly rootJobId?: string;
}

export interface GenerationJobFailedItem {
  readonly index: number;
  readonly error: string;
  /** Mirrors the shared `GenerationJobFailedItem.code` wire contract — see its docstring in `packages/shared`. */
  readonly code?: string;
}

export interface GenerationJobRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly createdBy: string;
  readonly createdByRole: Role;
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly count: number;
  readonly withFigure: boolean;
  readonly status: GenerationJobStatus;
  readonly createdCount: number;
  readonly failedCount: number;
  readonly createdQuestionIds: readonly string[];
  readonly failedItems: readonly GenerationJobFailedItem[];
  readonly cancelRequested: boolean;
  readonly retriedFromJobId: string | null;
  readonly rootJobId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

/**
 * `GenerationJobRecord` plus display fields only the history LIST needs: how
 * many attempts exist in its retry chain, and the course/topic names so each
 * row can show a title instead of just raw ids — `courseId`/`topicId` alone
 * mean nothing to a human scanning the history.
 */
export interface GenerationJobListRecord extends GenerationJobRecord {
  readonly attemptCount: number;
  readonly courseName: string;
  readonly topicName: string;
}

const TERMINAL_STATUSES: readonly GenerationJobStatus[] = ["completed", "failed", "cancelled"];

function toRecord(row: typeof generationJobs.$inferSelect): GenerationJobRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    createdBy: row.createdBy,
    createdByRole: row.createdByRole as Role,
    courseId: row.courseId,
    topicId: row.topicId,
    difficulty: row.difficulty as Difficulty,
    gradeLevel: row.gradeLevel,
    count: row.count,
    withFigure: row.withFigure,
    status: row.status,
    createdCount: row.createdCount,
    failedCount: row.failedCount,
    createdQuestionIds: row.createdQuestionIds as string[],
    failedItems: row.failedItems as GenerationJobFailedItem[],
    cancelRequested: row.cancelRequested,
    retriedFromJobId: row.retriedFromJobId,
    rootJobId: row.rootJobId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

/** All `generation_jobs` queries (design doc §3). Every method except `getByIdUnscoped()` (worker-only, no HTTP tenant context) takes/filters by `tenantId`. */
export class GenerationJobsRepository {
  /**
   * How many of this tenant's jobs are still in flight (`pending`/`running`).
   * Feeds the per-tenant active-job ceiling — each job is up to 10 OpenRouter
   * calls, so an unbounded pile-up is an unbounded bill (audit 2026-08-18).
   */
  async countActiveByTenant(tenantId: string): Promise<number> {
    const [{ value }] = await db
      .select({ value: count() })
      .from(generationJobs)
      .where(
        and(eq(generationJobs.tenantId, tenantId), inArray(generationJobs.status, ["pending", "running"])),
      );
    return Number(value);
  }

  async create(record: CreateGenerationJobRecord): Promise<GenerationJobRecord> {
    const [row] = await db.insert(generationJobs).values(record).returning();
    return toRecord(row!);
  }

  async getById(id: string, tenantId: string): Promise<GenerationJobRecord | undefined> {
    const [row] = await db
      .select()
      .from(generationJobs)
      .where(and(eq(generationJobs.id, id), eq(generationJobs.tenantId, tenantId)));
    return row ? toRecord(row) : undefined;
  }

  /** Tenant-unscoped lookup — used ONLY by `GenerationJobsProcessor`, which has no HTTP request/tenant context beyond what the row itself carries. */
  async getByIdUnscoped(id: string): Promise<GenerationJobRecord | undefined> {
    const [row] = await db.select().from(generationJobs).where(eq(generationJobs.id, id));
    return row ? toRecord(row) : undefined;
  }

  /**
   * One row per retry CHAIN, not per job row — a job that was retried has a
   * successor pointing `retried_from_job_id` back at it, so the `NOT EXISTS`
   * filter keeps only each chain's latest (leaf) attempt. `attemptCount` is a
   * correlated subquery (not a window function) specifically because it must
   * count every attempt in the chain, including the non-leaf ones this same
   * query just filtered out — a window function's partition would only see
   * the already-filtered leaf rows and always report 1.
   */
  async list(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: GenerationJobListRecord[]; total: number }> {
    const where = and(
      eq(generationJobs.tenantId, tenantId),
      sql`NOT EXISTS (SELECT 1 FROM generation_jobs child WHERE child.retried_from_job_id = ${generationJobs.id})`,
    );
    const [{ value: total }] = await db.select({ value: count() }).from(generationJobs).where(where);

    const rows = await db
      .select({
        row: generationJobs,
        courseName: courses.name,
        topicName: topics.name,
        // NOTE: the outer reference is written as literal `generation_jobs.*`
        // text, NOT `${generationJobs.rootJobId}` — a drizzle column embed
        // inside a SELECT-list `sql` fragment renders UNQUALIFIED (matching
        // how the rest of the SELECT list renders), so inside this nested
        // subquery it would resolve against `c2` (the closest FROM), not the
        // outer row, turning the whole comparison into a `c2.x = c2.x`
        // tautology that matches every row in the table. Spelling the outer
        // table's real (unaliased) name out avoids that misresolution.
        attemptCount: sql<number>`(
          SELECT count(*)::int FROM generation_jobs c2
          WHERE COALESCE(c2.root_job_id, c2.id) = COALESCE(generation_jobs.root_job_id, generation_jobs.id)
        )`,
      })
      .from(generationJobs)
      .innerJoin(courses, eq(generationJobs.courseId, courses.id))
      .innerJoin(topics, eq(generationJobs.topicId, topics.id))
      .where(where)
      .orderBy(
        sql`CASE WHEN ${generationJobs.status} IN ('pending','running') THEN 0 ELSE 1 END`,
        desc(generationJobs.createdAt),
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      items: rows.map((r) => ({
        ...toRecord(r.row),
        attemptCount: r.attemptCount,
        courseName: r.courseName,
        topicName: r.topicName,
      })),
      total,
    };
  }

  /** Every attempt in the chain rooted at `rootId` (itself included), oldest first — the full "historial de reintentos" for one job. */
  async listChain(tenantId: string, rootId: string): Promise<GenerationJobRecord[]> {
    const rows = await db
      .select()
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.tenantId, tenantId),
          or(eq(generationJobs.id, rootId), eq(generationJobs.rootJobId, rootId)),
        ),
      )
      .orderBy(asc(generationJobs.createdAt));
    return rows.map(toRecord);
  }

  async setStatus(id: string, status: GenerationJobStatus): Promise<void> {
    await db
      .update(generationJobs)
      .set({
        status,
        updatedAt: new Date(),
        completedAt: TERMINAL_STATUSES.includes(status) ? new Date() : undefined,
      })
      .where(eq(generationJobs.id, id));
  }

  /** Appends via a raw jsonb `||` concat + counter increment in ONE statement — the worker is the only writer per job, so no read-modify-write race, but this keeps the write atomic regardless. */
  async appendCreatedQuestion(id: string, questionId: string): Promise<void> {
    await db
      .update(generationJobs)
      .set({
        createdQuestionIds: sql`${generationJobs.createdQuestionIds} || ${JSON.stringify([questionId])}::jsonb`,
        createdCount: sql`${generationJobs.createdCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(generationJobs.id, id));
  }

  async appendFailedItem(id: string, item: GenerationJobFailedItem): Promise<void> {
    await db
      .update(generationJobs)
      .set({
        failedItems: sql`${generationJobs.failedItems} || ${JSON.stringify([item])}::jsonb`,
        failedCount: sql`${generationJobs.failedCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(generationJobs.id, id));
  }

  async isCancelRequested(id: string): Promise<boolean> {
    const [row] = await db
      .select({ cancelRequested: generationJobs.cancelRequested })
      .from(generationJobs)
      .where(eq(generationJobs.id, id));
    return row?.cancelRequested ?? false;
  }

  /** No-op if `id` doesn't exist or is already terminal — `GenerationJobsService.cancel()` decides what that means for the HTTP response. */
  async requestCancel(id: string): Promise<void> {
    await db
      .update(generationJobs)
      .set({ cancelRequested: true, updatedAt: new Date() })
      .where(and(eq(generationJobs.id, id), inArray(generationJobs.status, ["pending", "running"])));
  }
}
