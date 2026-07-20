import { Difficulty, Role } from "@exams-generator/shared";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { generationJobs } from "../../db/schema";
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
}

export interface GenerationJobFailedItem {
  readonly index: number;
  readonly error: string;
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
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

/** All `generation_jobs` queries (design doc §3). Every method except `getByIdUnscoped()` (worker-only, no HTTP tenant context) takes/filters by `tenantId`. */
export class GenerationJobsRepository {
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

  async list(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: GenerationJobRecord[]; total: number }> {
    const where = eq(generationJobs.tenantId, tenantId);
    const [{ value: total }] = await db.select({ value: count() }).from(generationJobs).where(where);

    const rows = await db
      .select()
      .from(generationJobs)
      .where(where)
      .orderBy(
        sql`CASE WHEN ${generationJobs.status} IN ('pending','running') THEN 0 ELSE 1 END`,
        desc(generationJobs.createdAt),
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return { items: rows.map(toRecord), total };
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
