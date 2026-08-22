# AI Generation History — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use a fresh worktree for this work.

**Goal:** Replace the client-orchestrated AI question-generation batch (`AiGenerateComponent` firing N sequential `POST /ai/questions/generate` calls) with a durable, server-owned job — the API runs the batch to completion regardless of the browser, survives navigation/refresh/tab-close/API-restart, and exposes list/get/cancel endpoints a future History UI consumes.

**Architecture:** New `generation_jobs` Postgres table is the durable, tenant-scoped record of every batch (source of truth for history/progress). BullMQ (new Redis-backed queue, `@nestjs/bullmq`) is the durable async executor. `GenerationJobsProcessor` (the BullMQ worker) does NOT reimplement per-item generation logic — it calls the EXISTING, unmodified `GenerateQuestionsService.generateQuestions(user, {...dto, count: 1})` once per remaining item, in a loop, resuming from `createdCount + failedCount` (not 0) so a BullMQ retry after a mid-batch crash never regenerates an already-persisted question. `GenerationJobsService` validates input synchronously (same checks `generateQuestions()` already runs) before ever touching the queue, so bad input still gets an immediate 400/404. The old synchronous `POST /ai/questions/generate` endpoint is removed in the final task — it has exactly one caller (`AiGenerateComponent`), which migrates to the new job endpoints in a separate frontend plan.

**Tech Stack:** NestJS 10.4 + Express (`apps/api`, `jest`); Drizzle ORM 0.33 + Postgres 17 (`drizzle-kit`); BullMQ 5.x via `@nestjs/bullmq` 11.x, Redis 7.4 (new `infra/docker-compose.yml` service — no queue infra exists in this repo today).

## Global Constraints

- **Cross-plan coordination risk:** a SEPARATE, already-partially-implemented plan exists at `docs/superpowers/plans/2026-07-19-ai-generate-streaming-progress.md` (live SSE token streaming during a single question's generation — a different, complementary feature). Its Task 3 plans to extract a `generateOneItem()` private method out of `GenerateQuestionsService.generateQuestions()`. **This plan deliberately does NOT touch `generate-questions.service.ts` at all** — the processor calls the existing public `generateQuestions()` with `count: 1`, exactly mirroring what `AiGenerateComponent` does today. This sidesteps any merge conflict with the other plan. If, by the time you implement this, the other plan's extraction has already landed, it changes nothing here — `generateQuestions()`'s public signature and behavior are unaffected by that refactor.
- **No queue infra exists today** — no Redis, no BullMQ, no `@nestjs/bullmq`. This plan adds all three.
- **Env var convention** (mirrors `MINIO_PORT`/`MINIO_API_PORT` in `infra/docker-compose.yml` + `bank/storage-provider.ts`): the app reads `REDIS_HOST`/`REDIS_PORT`, hardcoded inside the `api` container to the redis service's internal port (6379); a SEPARATE `REDIS_HOST_PORT` var controls the host-side port mapping for local dev outside Docker. Code fallback defaults assume bare local dev talking to the host-mapped port directly (`localhost:6390`).
- **Redis persistence is required, not optional** — AOF enabled + a named volume. Without it, a Redis restart loses BullMQ's queue state entirely, defeating the "must resume after API/Redis restart" requirement even though the Postgres `generation_jobs` row would still have checkpoint data (nothing would ever re-enqueue the job).
- **Tenant scoping**: every `generation_jobs` row belongs to exactly one tenant (`tenant_id`, matches `exams`/`questions`). `GenerationJobsService` never allows cross-tenant reads.
- **`created_by_role` column**: the BullMQ worker has no HTTP request context, so it can't obtain a full `AuthTokenPayload` (`{ sub, tenantId, role }`) any other way — `generateQuestions()` requires one. The job row stores the creator's `role` at creation time specifically so the processor can reconstruct it.
- **Shell commands:** `eza`/`bat`/`rg`/`fd`/`sd`, not `ls`/`cat`/`grep`/`find`/`sed`. Never build.
- **Conventional commits**, no AI attribution. **Author:** `jcsoftdev`.
- **API tests:** `cd apps/api && pnpm exec jest <path>`.
- **DB migrations:** `cd apps/api && pnpm db:generate` (writes a new file under `apps/api/drizzle/`), then `pnpm db:migrate` to apply it before running any test that touches the new table.
- **Strict TDD** — test first, watch it fail, minimal impl, watch it pass, commit.
- **Deploy/merge order:** this backend plan (including Task 5's removal of the old endpoint) must land in full before the companion frontend plan is merged — the frontend plan deletes `AiGenerateComponent`'s use of the old endpoint in the same change and depends on the new job endpoints existing.

---

## File Structure

**Backend (`apps/api/src`):**

- `db/schema/enums.ts` — add `GENERATION_JOB_STATUSES`/`generationJobStatusEnum`.
- `db/schema/generation-jobs.schema.ts` — **new**, the `generation_jobs` table.
- `db/schema/index.ts` — export it.
- `modules/ai/generation-jobs.repository.ts` — **new**, all `generation_jobs` queries.
- `modules/ai/generation-jobs.env.ts` — **new**, `resolveRedisConnection()`.
- `modules/ai/generation-jobs.processor.ts` — **new**, the BullMQ worker.
- `modules/ai/generation-jobs.service.ts` — **new**, validation + create/enqueue + list/get/cancel.
- `modules/ai/ai-jobs.controller.ts` — **new**, `/ai/questions/jobs` HTTP surface.
- `modules/ai/ai.module.ts` — register `BullModule`, the new providers/controller.
- `modules/ai/ai.controller.ts` — remove `POST /ai/questions/generate` (Task 5).
- `modules/ai/ai.e2e.spec.ts` — migrate off the removed endpoint (Task 5).

**Infra:**

- `infra/docker-compose.yml` — new `redis` service; `api` service gets `REDIS_HOST`/`REDIS_PORT` env + `depends_on`.
- `apps/api/package.json` — add `bullmq`, `@nestjs/bullmq`, `ioredis`.

---

## Task 1: `generation_jobs` schema + `GenerationJobsRepository`

**Files:**

- Modify: `apps/api/src/db/schema/enums.ts`
- Create: `apps/api/src/db/schema/generation-jobs.schema.ts`
- Modify: `apps/api/src/db/schema/index.ts`
- Create: `apps/api/src/modules/ai/generation-jobs.repository.ts`
- Test: `apps/api/src/modules/ai/generation-jobs.repository.spec.ts`

**Interfaces:**

- Produces: `GenerationJobStatus` (`"pending"|"running"|"completed"|"failed"|"cancelled"`), `generationJobs` table, `CreateGenerationJobRecord`, `GenerationJobRecord`, `GenerationJobFailedItem`, class `GenerationJobsRepository` with `create()`, `getById()`, `getByIdUnscoped()`, `list()`, `setStatus()`, `appendCreatedQuestion()`, `appendFailedItem()`, `isCancelRequested()`, `requestCancel()`.

- [ ] **Step 1: Add the status enum**

In `apps/api/src/db/schema/enums.ts`, add after `examStatusEnum` (end of file):

```ts
/**
 * A generation job's lifecycle (design doc:
 * docs/superpowers/specs/2026-07-19-ai-generation-history-design.md §3).
 * `failed` means the JOB errored out (crash, exhausted BullMQ retries) —
 * a job that ran to completion with some per-item failures is still
 * `completed`, with `createdCount < count`.
 */
export const GENERATION_JOB_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type GenerationJobStatus = (typeof GENERATION_JOB_STATUSES)[number];
export const generationJobStatusEnum = pgEnum("generation_job_status", GENERATION_JOB_STATUSES);
```

- [ ] **Step 2: Create the schema file**

Create `apps/api/src/db/schema/generation-jobs.schema.ts`:

```ts
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
```

- [ ] **Step 3: Export it from the schema barrel**

In `apps/api/src/db/schema/index.ts`, add at the end:

```ts
export * from "./generation-jobs.schema";
```

- [ ] **Step 4: Generate and apply the migration**

Run: `cd apps/api && pnpm db:generate`
Expected: a new file under `apps/api/drizzle/` (drizzle-kit auto-names it, e.g. `0005_<name>.sql`) containing `CREATE TYPE "generation_job_status"` and `CREATE TABLE "generation_jobs"`. Read it to confirm it matches the schema above.

Run: `cd apps/api && pnpm db:migrate`
Expected: `Migrations applied.` — this must succeed against the local docker-compose Postgres before Step 6 below can pass.

- [ ] **Step 5: Write the failing repository spec**

Create `apps/api/src/modules/ai/generation-jobs.repository.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { eq } from "drizzle-orm";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { courses, tenants, topics, users } from "../../db/schema";
import { GenerationJobsRepository } from "./generation-jobs.repository";

describe("GenerationJobsRepository", () => {
  const repository = new GenerationJobsRepository();

  let tenantId: string;
  let otherTenantId: string;
  let userId: string;
  let courseId: string;
  let topicId: string;

  beforeAll(async () => {
    await runMigrations();

    const suffix = randomUUID();

    const [tenant] = await db
      .insert(tenants)
      .values({ name: `GenJobs Tenant ${suffix}`, slug: `genjobs-tenant-${suffix}` })
      .returning({ id: tenants.id });
    tenantId = tenant!.id;

    const [otherTenant] = await db
      .insert(tenants)
      .values({ name: `GenJobs Other Tenant ${suffix}`, slug: `genjobs-other-tenant-${suffix}` })
      .returning({ id: tenants.id });
    otherTenantId = otherTenant!.id;

    const [user] = await db
      .insert(users)
      .values({
        tenantId,
        email: `genjobs-user-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    userId = user!.id;

    const [course] = await db
      .insert(courses)
      .values({ name: `GenJobs Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `GenJobs Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;
  });

  afterAll(async () => {
    await db.delete(topics).where(eq(topics.id, topicId));
    await db.delete(courses).where(eq(courses.id, courseId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await pool.end();
  });

  function baseInput() {
    return {
      tenantId,
      createdBy: userId,
      createdByRole: Role.Teacher,
      courseId,
      topicId,
      difficulty: Difficulty.Easy,
      gradeLevel: "primaria_1",
      count: 3,
      withFigure: false,
    };
  }

  it("create() persists a pending job with zeroed counters", async () => {
    const record = await repository.create(baseInput());

    expect(record.status).toBe("pending");
    expect(record.createdCount).toBe(0);
    expect(record.failedCount).toBe(0);
    expect(record.createdQuestionIds).toEqual([]);
    expect(record.failedItems).toEqual([]);
    expect(record.cancelRequested).toBe(false);
    expect(record.completedAt).toBeNull();
  });

  it("getById() returns undefined for a job scoped to a different tenant", async () => {
    const record = await repository.create(baseInput());

    expect(await repository.getById(record.id, otherTenantId)).toBeUndefined();
    expect(await repository.getById(record.id, tenantId)).toBeDefined();
  });

  it("appendCreatedQuestion() accumulates ids and increments createdCount", async () => {
    const record = await repository.create(baseInput());

    await repository.appendCreatedQuestion(record.id, "question-a");
    await repository.appendCreatedQuestion(record.id, "question-b");

    const updated = await repository.getById(record.id, tenantId);
    expect(updated!.createdQuestionIds).toEqual(["question-a", "question-b"]);
    expect(updated!.createdCount).toBe(2);
  });

  it("appendFailedItem() accumulates items and increments failedCount", async () => {
    const record = await repository.create(baseInput());

    await repository.appendFailedItem(record.id, { index: 0, error: "boom" });

    const updated = await repository.getById(record.id, tenantId);
    expect(updated!.failedItems).toEqual([{ index: 0, error: "boom" }]);
    expect(updated!.failedCount).toBe(1);
  });

  it("setStatus('completed') stamps completedAt; 'running' does not", async () => {
    const record = await repository.create(baseInput());

    await repository.setStatus(record.id, "running");
    expect((await repository.getById(record.id, tenantId))!.completedAt).toBeNull();

    await repository.setStatus(record.id, "completed");
    expect((await repository.getById(record.id, tenantId))!.completedAt).not.toBeNull();
  });

  it("requestCancel() sets the flag on a pending job", async () => {
    const record = await repository.create(baseInput());

    await repository.requestCancel(record.id);

    expect(await repository.isCancelRequested(record.id)).toBe(true);
  });

  it("requestCancel() is a no-op on an already-terminal job", async () => {
    const record = await repository.create(baseInput());
    await repository.setStatus(record.id, "completed");

    await repository.requestCancel(record.id);

    expect(await repository.isCancelRequested(record.id)).toBe(false);
  });

  it("list() sorts pending/running jobs before terminal ones, newest first within each group", async () => {
    const older = await repository.create(baseInput());
    await repository.setStatus(older.id, "completed");
    const running = await repository.create(baseInput());
    await repository.setStatus(running.id, "running");

    const { items, total } = await repository.list(tenantId, 1, 20);

    expect(total).toBeGreaterThanOrEqual(2);
    const runningIndex = items.findIndex((i) => i.id === running.id);
    const olderIndex = items.findIndex((i) => i.id === older.id);
    expect(runningIndex).toBeLessThan(olderIndex);
  });

  it("getByIdUnscoped() finds a job without a tenant filter — used only by the worker", async () => {
    const record = await repository.create(baseInput());

    expect(await repository.getByIdUnscoped(record.id)).toBeDefined();
  });
});
```

- [ ] **Step 2b: Run it, expect fail**

Run: `cd apps/api && pnpm exec jest src/modules/ai/generation-jobs.repository.spec.ts`
Expected: FAIL — `./generation-jobs.repository` module not found.

- [ ] **Step 6: Implement `GenerationJobsRepository`**

Create `apps/api/src/modules/ai/generation-jobs.repository.ts`:

```ts
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
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(generationJobs)
      .where(where);

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
      .where(
        and(eq(generationJobs.id, id), inArray(generationJobs.status, ["pending", "running"])),
      );
  }
}
```

- [ ] **Step 7: Run it, expect pass**

Run: `cd apps/api && pnpm exec jest src/modules/ai/generation-jobs.repository.spec.ts`
Expected: PASS — all 9 tests.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/db/schema apps/api/drizzle apps/api/src/modules/ai/generation-jobs.repository.ts apps/api/src/modules/ai/generation-jobs.repository.spec.ts
git commit -m "feat(api): add generation_jobs schema and GenerationJobsRepository"
```

---

## Task 2: Redis infra + BullMQ wiring + `GenerationJobsProcessor`

**Files:**

- Modify: `infra/docker-compose.yml`
- Modify: `apps/api/package.json`
- Create: `apps/api/src/modules/ai/generation-jobs.env.ts`
- Create: `apps/api/src/modules/ai/generation-jobs.processor.ts`
- Test: `apps/api/src/modules/ai/generation-jobs.processor.spec.ts`
- Modify: `apps/api/src/modules/ai/ai.module.ts`

**Interfaces:**

- Consumes: `GenerationJobsRepository` (Task 1), the existing `GenerateQuestionsService.generateQuestions()` (unmodified).
- Produces: `resolveRedisConnection(): { host: string; port: number }`; `GenerationJobData = { jobId: string }`; class `GenerationJobsProcessor` (BullMQ `@Processor("generation")`).

- [ ] **Step 1: Add Redis to `infra/docker-compose.yml`**

Add a new `redis` service (after `minio`, before `api`):

```yaml
redis:
  image: redis:7.4-bookworm
  restart: unless-stopped
  command: redis-server --appendonly yes
  volumes:
    - redis_data:/data
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s
    timeout: 5s
    retries: 10
  ports:
    - "${REDIS_HOST_PORT:-6390}:6379"
```

Add `redis` to the `api` service's `depends_on` and env:

```yaml
depends_on:
  postgres:
    condition: service_healthy
  minio:
    condition: service_healthy
  redis:
    condition: service_healthy
environment:
  DATABASE_URL: postgres://${DB_USER:-exams}:${DB_PASSWORD:-exams}@postgres:5432/${DB_NAME:-exams_generator}
  MINIO_ENDPOINT: minio
  MINIO_PORT: 9000
  MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minioadmin}
  MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minioadmin}
  REDIS_HOST: redis
  REDIS_PORT: 6379
  JWT_SECRET: ${JWT_SECRET:?JWT_SECRET must be set}
  AI_MODEL: ${AI_MODEL}
  PORT: 3000
```

Add `redis_data:` to the top-level `volumes:` block.

- [ ] **Step 2: Start Redis locally**

Run: `cd infra && docker compose up -d redis`
Expected: `redis` container starts and reports healthy (`docker compose ps redis` shows `healthy`).

- [ ] **Step 3: Add dependencies**

In `apps/api/package.json`, add to `dependencies`:

```json
    "@nestjs/bullmq": "^11.0.4",
    "bullmq": "^5.80.9",
    "ioredis": "^5.11.1",
```

Run: `pnpm install`
Expected: lockfile updates, no errors.

- [ ] **Step 4: Env resolver**

Create `apps/api/src/modules/ai/generation-jobs.env.ts`:

```ts
export interface RedisConnectionConfig {
  readonly host: string;
  readonly port: number;
}

/**
 * Resolves Redis connection config for the `generation` BullMQ queue,
 * mirroring `resolveDatabaseUrl()` (`db/env.ts`) and `resolveStorageAdapter()`
 * (`bank/storage-provider.ts`): the SAME env var names the `api` service in
 * `infra/docker-compose.yml` sets (container-internal port 6379), falling
 * back to the docker-compose HOST-mapped port (6390) for bare local dev
 * outside Docker.
 */
export function resolveRedisConnection(): RedisConnectionConfig {
  return {
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? 6390),
  };
}
```

- [ ] **Step 5: Write the failing processor spec**

Create `apps/api/src/modules/ai/generation-jobs.processor.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { Job } from "bullmq";
import { GenerateQuestionsService } from "./generate-questions.service";
import { GenerationJobsProcessor } from "./generation-jobs.processor";
import { GenerationJobsRepository } from "./generation-jobs.repository";

const BASE_RECORD = {
  id: "job-1",
  tenantId: "tenant-1",
  createdBy: "user-1",
  createdByRole: Role.Teacher,
  courseId: "course-1",
  topicId: "topic-1",
  difficulty: Difficulty.Easy,
  gradeLevel: "primaria_1",
  withFigure: false,
  cancelRequested: false,
  createdQuestionIds: [] as string[],
  failedItems: [] as { index: number; error: string }[],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null as string | null,
};

function buildDeps() {
  const repository = {
    getByIdUnscoped: jest.fn(),
    setStatus: jest.fn().mockResolvedValue(undefined),
    appendCreatedQuestion: jest.fn().mockResolvedValue(undefined),
    appendFailedItem: jest.fn().mockResolvedValue(undefined),
    isCancelRequested: jest.fn().mockResolvedValue(false),
  } as unknown as jest.Mocked<GenerationJobsRepository>;

  const generateQuestionsService = {
    generateQuestions: jest.fn(),
  } as unknown as jest.Mocked<GenerateQuestionsService>;

  const processor = new GenerationJobsProcessor(repository, generateQuestionsService);
  return { processor, repository, generateQuestionsService };
}

function job(jobId: string): Job<{ jobId: string }> {
  return { data: { jobId } } as Job<{ jobId: string }>;
}

describe("GenerationJobsProcessor", () => {
  it("calls generateQuestions once per item (count:1) and appends each created id", async () => {
    const { processor, repository, generateQuestionsService } = buildDeps();
    repository.getByIdUnscoped.mockResolvedValue({
      ...BASE_RECORD,
      count: 3,
      createdCount: 0,
      failedCount: 0,
      status: "pending",
    });
    generateQuestionsService.generateQuestions
      .mockResolvedValueOnce({ created: [{ id: "q1" }], failed: [] })
      .mockResolvedValueOnce({ created: [{ id: "q2" }], failed: [] })
      .mockResolvedValueOnce({ created: [{ id: "q3" }], failed: [] });

    await processor.process(job("job-1"));

    expect(generateQuestionsService.generateQuestions).toHaveBeenCalledTimes(3);
    expect(generateQuestionsService.generateQuestions).toHaveBeenCalledWith(
      { sub: "user-1", tenantId: "tenant-1", role: Role.Teacher },
      {
        courseId: "course-1",
        topicId: "topic-1",
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        count: 1,
        withFigure: false,
      },
    );
    expect(repository.appendCreatedQuestion).toHaveBeenNthCalledWith(1, "job-1", "q1");
    expect(repository.appendCreatedQuestion).toHaveBeenNthCalledWith(3, "job-1", "q3");
    expect(repository.setStatus).toHaveBeenCalledWith("job-1", "running");
    expect(repository.setStatus).toHaveBeenCalledWith("job-1", "completed");
  });

  it("records a per-item failure with the correct batch index, not the inner call's index:0", async () => {
    const { processor, repository, generateQuestionsService } = buildDeps();
    repository.getByIdUnscoped.mockResolvedValue({
      ...BASE_RECORD,
      count: 2,
      createdCount: 0,
      failedCount: 0,
      status: "pending",
    });
    generateQuestionsService.generateQuestions
      .mockResolvedValueOnce({ created: [], failed: [{ index: 0, error: "Typst compile failed" }] })
      .mockResolvedValueOnce({ created: [{ id: "q2" }], failed: [] });

    await processor.process(job("job-1"));

    expect(repository.appendFailedItem).toHaveBeenCalledWith("job-1", {
      index: 0,
      error: "Typst compile failed",
    });
    expect(repository.appendCreatedQuestion).toHaveBeenCalledWith("job-1", "q2");
  });

  it("resumes from createdCount + failedCount instead of restarting at 0 (checkpoint-resume)", async () => {
    const { processor, repository, generateQuestionsService } = buildDeps();
    repository.getByIdUnscoped.mockResolvedValue({
      ...BASE_RECORD,
      count: 5,
      createdCount: 2,
      failedCount: 1,
      status: "running",
    });
    generateQuestionsService.generateQuestions
      .mockResolvedValueOnce({ created: [{ id: "q4" }], failed: [] })
      .mockResolvedValueOnce({ created: [{ id: "q5" }], failed: [] });

    await processor.process(job("job-1"));

    expect(generateQuestionsService.generateQuestions).toHaveBeenCalledTimes(2);
    expect(repository.appendFailedItem).not.toHaveBeenCalled();
  });

  it("stops cooperatively when cancelRequested flips true between items, and marks the job cancelled", async () => {
    const { processor, repository, generateQuestionsService } = buildDeps();
    repository.getByIdUnscoped.mockResolvedValue({
      ...BASE_RECORD,
      count: 3,
      createdCount: 0,
      failedCount: 0,
      status: "pending",
    });
    repository.isCancelRequested.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    generateQuestionsService.generateQuestions.mockResolvedValueOnce({
      created: [{ id: "q1" }],
      failed: [],
    });

    await processor.process(job("job-1"));

    expect(generateQuestionsService.generateQuestions).toHaveBeenCalledTimes(1);
    expect(repository.setStatus).toHaveBeenCalledWith("job-1", "cancelled");
    expect(repository.setStatus).not.toHaveBeenCalledWith("job-1", "completed");
  });

  it("no-ops when the job row is missing or already terminal", async () => {
    const { processor, repository, generateQuestionsService } = buildDeps();
    repository.getByIdUnscoped.mockResolvedValue({
      ...BASE_RECORD,
      count: 3,
      createdCount: 0,
      failedCount: 0,
      status: "completed",
    });

    await processor.process(job("job-1"));

    expect(generateQuestionsService.generateQuestions).not.toHaveBeenCalled();
    expect(repository.setStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run it, expect fail**

Run: `cd apps/api && pnpm exec jest src/modules/ai/generation-jobs.processor.spec.ts`
Expected: FAIL — `./generation-jobs.processor` module not found.

- [ ] **Step 7: Implement `GenerationJobsProcessor`**

Create `apps/api/src/modules/ai/generation-jobs.processor.ts`:

```ts
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Role } from "@exams-generator/shared";
import { Job } from "bullmq";
import { AuthTokenPayload } from "../auth/token.service";
import { GenerateQuestionsService } from "./generate-questions.service";
import { GenerationJobStatus } from "../../db/schema/enums";
import { GenerationJobsRepository } from "./generation-jobs.repository";

export interface GenerationJobData {
  readonly jobId: string;
}

const TERMINAL_STATUSES: readonly GenerationJobStatus[] = ["completed", "failed", "cancelled"];

/**
 * BullMQ worker for the `generation` queue (design doc §5). Deliberately
 * reuses `GenerateQuestionsService.generateQuestions()` unmodified, called
 * once per remaining item with `count: 1` — the SAME call
 * `AiGenerateComponent` makes today, just server-driven instead of
 * client-driven. Resumes from `createdCount + failedCount` (not 0) so a
 * BullMQ retry after a mid-batch crash never regenerates an
 * already-persisted question.
 */
@Processor("generation", { concurrency: 2 })
export class GenerationJobsProcessor extends WorkerHost {
  constructor(
    private readonly repository: GenerationJobsRepository,
    private readonly generateQuestionsService: GenerateQuestionsService,
  ) {
    super();
  }

  async process(job: Job<GenerationJobData>): Promise<void> {
    const record = await this.repository.getByIdUnscoped(job.data.jobId);
    if (!record || TERMINAL_STATUSES.includes(record.status)) {
      return;
    }

    await this.repository.setStatus(record.id, "running");

    const user: AuthTokenPayload = {
      sub: record.createdBy,
      tenantId: record.tenantId,
      role: record.createdByRole as Role,
    };

    const startIndex = record.createdCount + record.failedCount;

    for (let index = startIndex; index < record.count; index += 1) {
      if (await this.repository.isCancelRequested(record.id)) {
        await this.repository.setStatus(record.id, "cancelled");
        return;
      }

      const result = await this.generateQuestionsService.generateQuestions(user, {
        courseId: record.courseId,
        topicId: record.topicId,
        difficulty: record.difficulty,
        gradeLevel: record.gradeLevel,
        count: 1,
        withFigure: record.withFigure,
      });

      if (result.created.length > 0) {
        await this.repository.appendCreatedQuestion(record.id, result.created[0]!.id);
      } else {
        await this.repository.appendFailedItem(record.id, {
          index,
          error: result.failed[0]?.error ?? "Unknown generation failure",
        });
      }
    }

    await this.repository.setStatus(record.id, "completed");
  }
}
```

- [ ] **Step 8: Run it, expect pass**

Run: `cd apps/api && pnpm exec jest src/modules/ai/generation-jobs.processor.spec.ts`
Expected: PASS — all 5 tests.

- [ ] **Step 9: Wire BullMQ into `AiModule`**

In `apps/api/src/modules/ai/ai.module.ts`, replace the file:

```ts
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { BankModule } from "../bank/bank.module";
import { LazyQuestionGeneratorAdapter } from "./adapters/lazy-question-generator.adapter";
import { AiController } from "./ai.controller";
import { QUESTION_GENERATOR_PORT } from "./ai.constants";
import { resolveQuestionGeneratorAdapter } from "./ai-provider";
import { resolveRedisConnection } from "./generation-jobs.env";
import { GenerationJobsProcessor } from "./generation-jobs.processor";
import { GenerationJobsRepository } from "./generation-jobs.repository";
import { ExtractQuestionService } from "./extract-question.service";
import { GenerateQuestionsService } from "./generate-questions.service";
import { ReviseQuestionService } from "./revise-question.service";

/**
 * Provides `QuestionGeneratorPort`, the draft-generation/revise/extract
 * endpoints, and the durable `generation` BullMQ queue (design doc:
 * docs/superpowers/specs/2026-07-19-ai-generation-history-design.md). See
 * `ai.module.ts`'s original docstring for why `QUESTION_GENERATOR_PORT` is
 * built lazily.
 */
@Module({
  imports: [
    BankModule,
    BullModule.forRoot({
      connection: resolveRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 60 * 60 * 24 * 7 },
        removeOnFail: { age: 60 * 60 * 24 * 7 },
      },
    }),
    BullModule.registerQueue({ name: "generation" }),
  ],
  controllers: [AiController],
  providers: [
    GenerateQuestionsService,
    ReviseQuestionService,
    ExtractQuestionService,
    GenerationJobsRepository,
    GenerationJobsProcessor,
    {
      provide: QUESTION_GENERATOR_PORT,
      useFactory: () => new LazyQuestionGeneratorAdapter(resolveQuestionGeneratorAdapter),
    },
  ],
  exports: [QUESTION_GENERATOR_PORT, GenerationJobsRepository],
})
export class AiModule {}
```

- [ ] **Step 10: Full AI module regression check**

Run: `cd apps/api && pnpm exec jest src/modules/ai`
Expected: PASS — every existing spec plus the two new ones from this task. (`ai.e2e.spec.ts` still passes unchanged — Task 2 doesn't touch `ai.controller.ts`.)

- [ ] **Step 11: Commit**

```bash
git add infra/docker-compose.yml apps/api/package.json apps/api/pnpm-lock.yaml apps/api/src/modules/ai/generation-jobs.env.ts apps/api/src/modules/ai/generation-jobs.processor.ts apps/api/src/modules/ai/generation-jobs.processor.spec.ts apps/api/src/modules/ai/ai.module.ts
git commit -m "feat(api): add Redis/BullMQ infra and GenerationJobsProcessor"
```

---

## Task 3: `GenerationJobsService`

**Files:**

- Create: `apps/api/src/modules/ai/generation-jobs.service.ts`
- Test: `apps/api/src/modules/ai/generation-jobs.service.spec.ts`

**Interfaces:**

- Consumes: `GenerationJobsRepository` (Task 1), `BankRepository.findCourseAndTopicNames` (existing), `validateGenerateQuestionsInput` (existing), BullMQ `Queue<GenerationJobData>` (Task 2's `GenerationJobData`).
- Produces: `CreateGenerationJobDto`, class `GenerationJobsService` with `create()`, `get()`, `list()`, `cancel()`.

- [ ] **Step 1: Write the failing service spec**

Create `apps/api/src/modules/ai/generation-jobs.service.spec.ts`:

```ts
import { Difficulty, Role } from "@exams-generator/shared";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { BankRepository } from "../bank/bank.repository";
import { GenerationJobsRepository } from "./generation-jobs.repository";
import { GenerationJobsService } from "./generation-jobs.service";

const TEACHER: AuthTokenPayload = { sub: "user-1", tenantId: "tenant-1", role: Role.Teacher };
const STAFF: AuthTokenPayload = { sub: "staff-1", tenantId: null, role: Role.ContentEditor };

const VALID_DTO = {
  courseId: "course-1",
  topicId: "topic-1",
  difficulty: Difficulty.Easy,
  gradeLevel: "primaria_1",
  count: 5,
  withFigure: false,
};

const JOB_RECORD = {
  id: "job-1",
  tenantId: "tenant-1",
  createdBy: "user-1",
  createdByRole: Role.Teacher,
  courseId: "course-1",
  topicId: "topic-1",
  difficulty: Difficulty.Easy,
  gradeLevel: "primaria_1",
  count: 5,
  withFigure: false,
  status: "pending" as const,
  createdCount: 0,
  failedCount: 0,
  createdQuestionIds: [] as string[],
  failedItems: [] as { index: number; error: string }[],
  cancelRequested: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null as string | null,
};

function buildDeps() {
  const repository = {
    create: jest.fn().mockResolvedValue(JOB_RECORD),
    getById: jest.fn().mockResolvedValue(JOB_RECORD),
    list: jest.fn().mockResolvedValue({ items: [JOB_RECORD], total: 1 }),
    requestCancel: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<GenerationJobsRepository>;

  const bankRepository = {
    findCourseAndTopicNames: jest
      .fn()
      .mockResolvedValue({ courseName: "Matemática", topicName: "Fracciones" }),
  } as unknown as jest.Mocked<BankRepository>;

  const queue = { add: jest.fn().mockResolvedValue(undefined) };

  const service = new GenerationJobsService(repository, bankRepository, queue as never);
  return { service, repository, bankRepository, queue };
}

describe("GenerationJobsService.create", () => {
  it("rejects with BadRequestException (no enqueue) when required fields are missing", async () => {
    const { service, queue, bankRepository } = buildDeps();

    await expect(service.create(TEACHER, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(bankRepository.findCourseAndTopicNames).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("rejects with NotFoundException (no enqueue) when courseId/topicId don't resolve", async () => {
    const { service, bankRepository, queue } = buildDeps();
    bankRepository.findCourseAndTopicNames.mockResolvedValue(undefined);

    await expect(service.create(TEACHER, VALID_DTO)).rejects.toBeInstanceOf(NotFoundException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("rejects with BadRequestException for a staff user with no tenant", async () => {
    const { service } = buildDeps();

    await expect(service.create(STAFF, VALID_DTO)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("creates the row then enqueues a BullMQ job keyed by the row id", async () => {
    const { service, repository, queue } = buildDeps();

    const record = await service.create(TEACHER, VALID_DTO);

    expect(record).toBe(JOB_RECORD);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        createdBy: "user-1",
        createdByRole: Role.Teacher,
        count: 5,
      }),
    );
    expect(queue.add).toHaveBeenCalledWith("generate", { jobId: "job-1" }, { jobId: "job-1" });
  });
});

describe("GenerationJobsService.get/list/cancel", () => {
  it("get() throws NotFoundException when the repository returns nothing", async () => {
    const { service, repository } = buildDeps();
    repository.getById.mockResolvedValue(undefined);

    await expect(service.get(TEACHER, "job-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("cancel() requests cancellation for a pending/running job and returns the refreshed record", async () => {
    const { service, repository } = buildDeps();

    await service.cancel(TEACHER, "job-1");

    expect(repository.requestCancel).toHaveBeenCalledWith("job-1");
  });

  it("cancel() is a no-op (still succeeds) for an already-terminal job", async () => {
    const { service, repository } = buildDeps();
    repository.getById.mockResolvedValue({ ...JOB_RECORD, status: "completed" });

    const result = await service.cancel(TEACHER, "job-1");

    expect(repository.requestCancel).not.toHaveBeenCalled();
    expect(result.status).toBe("completed");
  });

  it("list() delegates to the repository scoped by the caller's tenant", async () => {
    const { service, repository } = buildDeps();

    const result = await service.list(TEACHER, 2, 10);

    expect(repository.list).toHaveBeenCalledWith("tenant-1", 2, 10);
    expect(result.total).toBe(1);
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `cd apps/api && pnpm exec jest src/modules/ai/generation-jobs.service.spec.ts`
Expected: FAIL — `./generation-jobs.service` module not found.

- [ ] **Step 3: Implement `GenerationJobsService`**

Create `apps/api/src/modules/ai/generation-jobs.service.ts`:

```ts
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Difficulty } from "@exams-generator/shared";
import { Queue } from "bullmq";
import { AuthTokenPayload } from "../auth/token.service";
import { BankRepository } from "../bank/bank.repository";
import { validateGenerateQuestionsInput } from "./domain/validate-generate-questions-input";
import { GenerationJobData } from "./generation-jobs.processor";
import { GenerationJobRecord, GenerationJobsRepository } from "./generation-jobs.repository";

export interface CreateGenerationJobDto {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: string;
  readonly gradeLevel?: string;
  readonly count?: number;
  readonly withFigure?: boolean;
}

/**
 * `/ai/questions/jobs` use cases (design doc §4). `create()` validates
 * synchronously — same checks `GenerateQuestionsService.generateQuestions()`
 * already runs — BEFORE ever touching the queue, so bad input still gets an
 * immediate 400/404 and nothing is enqueued.
 */
@Injectable()
export class GenerationJobsService {
  constructor(
    private readonly repository: GenerationJobsRepository,
    private readonly bankRepository: BankRepository,
    @InjectQueue("generation") private readonly queue: Queue<GenerationJobData>,
  ) {}

  async create(user: AuthTokenPayload, dto: CreateGenerationJobDto): Promise<GenerationJobRecord> {
    const tenantId = this.requireTenant(user);

    const validation = validateGenerateQuestionsInput(dto);
    if (!validation.ok) {
      throw new BadRequestException(validation.errors);
    }

    const taxonomy = await this.bankRepository.findCourseAndTopicNames(
      dto.courseId as string,
      dto.topicId as string,
    );
    if (!taxonomy) {
      throw new NotFoundException(
        "courseId/topicId not found, or topicId does not belong to courseId",
      );
    }

    const record = await this.repository.create({
      tenantId,
      createdBy: user.sub,
      createdByRole: user.role,
      courseId: dto.courseId as string,
      topicId: dto.topicId as string,
      difficulty: dto.difficulty as Difficulty,
      gradeLevel: dto.gradeLevel as string,
      count: dto.count as number,
      withFigure: dto.withFigure ?? false,
    });

    await this.queue.add("generate", { jobId: record.id }, { jobId: record.id });

    return record;
  }

  async get(user: AuthTokenPayload, jobId: string): Promise<GenerationJobRecord> {
    const tenantId = this.requireTenant(user);
    const record = await this.repository.getById(jobId, tenantId);
    if (!record) {
      throw new NotFoundException(`Generation job not found: ${jobId}`);
    }
    return record;
  }

  async list(
    user: AuthTokenPayload,
    page: number,
    pageSize: number,
  ): Promise<{ items: GenerationJobRecord[]; total: number }> {
    const tenantId = this.requireTenant(user);
    return this.repository.list(tenantId, page, pageSize);
  }

  /** Idempotent: cancelling an already-terminal job succeeds without error, matching `GenerationJobsRepository.requestCancel()`'s no-op semantics. */
  async cancel(user: AuthTokenPayload, jobId: string): Promise<GenerationJobRecord> {
    const tenantId = this.requireTenant(user);
    const record = await this.repository.getById(jobId, tenantId);
    if (!record) {
      throw new NotFoundException(`Generation job not found: ${jobId}`);
    }
    if (record.status === "pending" || record.status === "running") {
      await this.repository.requestCancel(jobId);
      return (await this.repository.getById(jobId, tenantId))!;
    }
    return record;
  }

  private requireTenant(user: AuthTokenPayload): string {
    if (!user.tenantId) {
      throw new BadRequestException("Only tenant users can access generation jobs");
    }
    return user.tenantId;
  }
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `cd apps/api && pnpm exec jest src/modules/ai/generation-jobs.service.spec.ts`
Expected: PASS — all 8 tests.

- [ ] **Step 5: Register the provider and export it**

In `apps/api/src/modules/ai/ai.module.ts`, add the import and provider (the file already has the rest from Task 2):

```ts
import { GenerationJobsService } from "./generation-jobs.service";
```

Add `GenerationJobsService` to the `providers` array (after `GenerationJobsRepository`), and add it to `exports` alongside `QUESTION_GENERATOR_PORT`/`GenerationJobsRepository`.

- [ ] **Step 6: Full module regression check**

Run: `cd apps/api && pnpm exec jest src/modules/ai`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/ai/generation-jobs.service.ts apps/api/src/modules/ai/generation-jobs.service.spec.ts apps/api/src/modules/ai/ai.module.ts
git commit -m "feat(api): add GenerationJobsService"
```

---

## Task 4: `AiJobsController` — `/ai/questions/jobs`

**Files:**

- Create: `apps/api/src/modules/ai/ai-jobs.controller.ts`
- Create: `apps/api/src/modules/ai/ai-jobs.e2e.spec.ts`
- Modify: `apps/api/src/modules/ai/ai.module.ts`

**Interfaces:**

- Consumes: `GenerationJobsService` (Task 3).
- Produces: `POST /ai/questions/jobs` (202), `GET /ai/questions/jobs` (200, paginated), `GET /ai/questions/jobs/:id` (200), `POST /ai/questions/jobs/:id/cancel` (200).

- [ ] **Step 1: Write the failing e2e spec**

Create `apps/api/src/modules/ai/ai-jobs.e2e.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { courses, questions, tenants, topics, users } from "../../db/schema";
import { TokenService } from "../auth/token.service";
import { isTypstAvailableSync } from "../exams/adapters/pdf/test-utils/typst-availability";
import { GeneratedQuestion, QuestionGeneratorPort } from "./domain/ports/question-generator.port";
import { QUESTION_GENERATOR_PORT } from "./ai.constants";

const VALID_QUESTION: GeneratedQuestion = {
  bodyTypst: "¿Cuál es el resultado de $1 + 1$?",
  alternatives: ["1", "2", "3", "4", "5"],
  correctAnswer: "b",
};

class ScriptedQuestionGeneratorAdapter implements QuestionGeneratorPort {
  async generate(): Promise<GeneratedQuestion> {
    return VALID_QUESTION;
  }
  async reviseQuestion(): Promise<GeneratedQuestion> {
    throw new Error("not used");
  }
  async extractFromImage(): Promise<GeneratedQuestion> {
    throw new Error("not used");
  }
}

const describeIfTypst = isTypstAvailableSync() ? describe : describe.skip;

describeIfTypst("AI generation jobs (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  let courseId: string;
  let topicId: string;
  let tenantAId: string;
  let teacherAId: string;
  let tenantBId: string;
  let teacherBId: string;
  let tokenA: string;
  let tokenB: string;

  const createdQuestionIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(QUESTION_GENERATOR_PORT)
      .useValue(new ScriptedQuestionGeneratorAdapter())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    const suffix = randomUUID();

    const [course] = await db
      .insert(courses)
      .values({ name: `Jobs E2E Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `Jobs E2E Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `Jobs E2E Tenant A ${suffix}`, slug: `jobs-e2e-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;
    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `jobs-e2e-a-${suffix}@exams-generator.test`,
        passwordHash: "x",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    teacherAId = teacherA!.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `Jobs E2E Tenant B ${suffix}`, slug: `jobs-e2e-tenant-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;
    const [teacherB] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `jobs-e2e-b-${suffix}@exams-generator.test`,
        passwordHash: "x",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    teacherBId = teacherB!.id;

    tokenA = tokenService.sign({ sub: teacherAId, tenantId: tenantAId, role: Role.Teacher });
    tokenB = tokenService.sign({ sub: teacherBId, tenantId: tenantBId, role: Role.Teacher });
  });

  afterAll(async () => {
    if (createdQuestionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
    }
    await db.delete(users).where(inArray(users.id, [teacherAId, teacherBId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]));
    await db.delete(topics).where(inArray(topics.id, [topicId]));
    await db.delete(courses).where(inArray(courses.id, [courseId]));
    await app.close();
    await pool.end();
  });

  function validBody() {
    return {
      courseId,
      topicId,
      difficulty: Difficulty.Easy,
      gradeLevel: "primaria_1",
      count: 2,
      withFigure: false,
    };
  }

  async function waitForTerminal(token: string, jobId: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const res = await request(app.getHttpServer())
        .get(`/ai/questions/jobs/${jobId}`)
        .set("Authorization", `Bearer ${token}`);
      if (["completed", "failed", "cancelled"].includes(res.body.status)) {
        return res.body;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Job ${jobId} did not reach a terminal status in time`);
  }

  it("creates a job (202, pending) that reaches completed with the requested count of created questions", async () => {
    const created = await request(app.getHttpServer())
      .post("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(validBody())
      .expect(202);

    expect(created.body.status).toBe("pending");
    expect(created.body.count).toBe(2);

    const final = await waitForTerminal(tokenA, created.body.id);
    expect(final.status).toBe("completed");
    expect(final.createdQuestionIds as string[]).toHaveLength(2);
    createdQuestionIds.push(...(final.createdQuestionIds as string[]));
  });

  it("rejects with 400 when required fields are missing, without creating a job", async () => {
    await request(app.getHttpServer())
      .post("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({})
      .expect(400);
  });

  it("rejects with 401 when no Authorization header is sent", async () => {
    await request(app.getHttpServer()).post("/ai/questions/jobs").send(validBody()).expect(401);
  });

  it("tenant B cannot read tenant A's job (404)", async () => {
    const created = await request(app.getHttpServer())
      .post("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(validBody())
      .expect(202);
    await waitForTerminal(tokenA, created.body.id).then((r) =>
      createdQuestionIds.push(...(r.createdQuestionIds as string[])),
    );

    await request(app.getHttpServer())
      .get(`/ai/questions/jobs/${created.body.id}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(404);
  });

  it("GET /ai/questions/jobs only lists the caller's tenant's jobs", async () => {
    const created = await request(app.getHttpServer())
      .post("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(validBody())
      .expect(202);
    await waitForTerminal(tokenA, created.body.id).then((r) =>
      createdQuestionIds.push(...(r.createdQuestionIds as string[])),
    );

    const listA = await request(app.getHttpServer())
      .get("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);
    expect(listA.body.items.map((i: { id: string }) => i.id)).toContain(created.body.id);

    const listB = await request(app.getHttpServer())
      .get("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(200);
    expect(listB.body.items.map((i: { id: string }) => i.id)).not.toContain(created.body.id);
  });

  it("cancel stops the job before it completes every requested item", async () => {
    const created = await request(app.getHttpServer())
      .post("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ ...validBody(), count: 10 })
      .expect(202);

    await request(app.getHttpServer())
      .post(`/ai/questions/jobs/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);

    const final = await waitForTerminal(tokenA, created.body.id);
    expect(final.status).toBe("cancelled");
    expect(final.createdCount as number).toBeLessThan(10);
    createdQuestionIds.push(...(final.createdQuestionIds as string[]));
  });

  it("cancelling an already-terminal job is a no-op that still returns 200", async () => {
    const created = await request(app.getHttpServer())
      .post("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(validBody())
      .expect(202);
    const final = await waitForTerminal(tokenA, created.body.id);
    createdQuestionIds.push(...(final.createdQuestionIds as string[]));

    const response = await request(app.getHttpServer())
      .post(`/ai/questions/jobs/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);
    expect(response.body.status).toBe("completed");
  });

  it("tenant B cannot cancel tenant A's job (404)", async () => {
    const created = await request(app.getHttpServer())
      .post("/ai/questions/jobs")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(validBody())
      .expect(202);

    await request(app.getHttpServer())
      .post(`/ai/questions/jobs/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(404);

    const final = await waitForTerminal(tokenA, created.body.id);
    createdQuestionIds.push(...(final.createdQuestionIds as string[]));
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `cd apps/api && pnpm exec jest src/modules/ai/ai-jobs.e2e.spec.ts`
Expected: FAIL — 404s (route doesn't exist).

- [ ] **Step 3: Implement the controller**

Create `apps/api/src/modules/ai/ai-jobs.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { clampPagination } from "../../common/pagination.util";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { CreateGenerationJobDto, GenerationJobsService } from "./generation-jobs.service";

/**
 * `/ai/questions/jobs` — durable AI-generation batch jobs (design doc:
 * docs/superpowers/specs/2026-07-19-ai-generation-history-design.md §4).
 * `POST /` responds 202 (Accepted), not 201 — the job is queued, not yet
 * done. Same guard as `AiController` (any authenticated tenant user, no
 * role restriction).
 */
@Controller("ai/questions/jobs")
@UseGuards(JwtAuthGuard)
export class AiJobsController {
  constructor(private readonly service: GenerationJobsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(@CurrentUser() user: AuthTokenPayload, @Body() body: CreateGenerationJobDto) {
    return this.service.create(user, body);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthTokenPayload,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    const { page: p, pageSize: ps } = clampPagination(page, pageSize);
    return this.service.list(user, p, ps);
  }

  @Get(":id")
  async get(@CurrentUser() user: AuthTokenPayload, @Param("id") id: string) {
    return this.service.get(user, id);
  }

  @Post(":id/cancel")
  async cancel(@CurrentUser() user: AuthTokenPayload, @Param("id") id: string) {
    return this.service.cancel(user, id);
  }
}
```

- [ ] **Step 4: Register it in `AiModule`**

In `apps/api/src/modules/ai/ai.module.ts`, import `AiJobsController` and add it to `controllers: [AiController, AiJobsController]`.

- [ ] **Step 5: Run it, expect pass**

Run: `cd apps/api && pnpm exec jest src/modules/ai/ai-jobs.e2e.spec.ts`
Expected: PASS — all 8 tests. (This exercises the real processor/Redis/Postgres end to end — make sure `docker compose up -d redis postgres minio` is running first.)

- [ ] **Step 6: Full API regression check**

Run: `cd apps/api && pnpm exec jest`
Expected: PASS — every existing suite plus everything from this plan so far.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/ai/ai-jobs.controller.ts apps/api/src/modules/ai/ai-jobs.e2e.spec.ts apps/api/src/modules/ai/ai.module.ts
git commit -m "feat(api): add POST/GET /ai/questions/jobs endpoints"
```

---

## Task 5: Remove the old synchronous batch endpoint

**Files:**

- Modify: `apps/api/src/modules/ai/ai.controller.ts`
- Modify: `apps/api/src/modules/ai/ai.e2e.spec.ts`

**Interfaces:**

- Removes: `POST /ai/questions/generate` and `GenerateQuestionsBody`/the `generate()` controller method. `GenerateQuestionsService` itself is UNCHANGED (still used internally by `GenerationJobsProcessor`).

- [ ] **Step 1: Remove the endpoint**

In `apps/api/src/modules/ai/ai.controller.ts`:

- Remove the `GenerateQuestionsBody` interface.
- Remove the `generate()` method (the `@Post("generate")` handler).
- Remove the now-unused `GenerateQuestionsResult`/`GenerateQuestionsService` imports if `GenerateQuestionsService` is no longer injected in this controller's constructor — it isn't used by `revise`/`extract`, so also remove it from the constructor and the corresponding import.

The resulting constructor:

```ts
  constructor(
    private readonly reviseService: ReviseQuestionService,
    private readonly extractService: ExtractQuestionService,
  ) {}
```

- [ ] **Step 2: Rewrite `ai.e2e.spec.ts` to create drafts via the job flow**

The `revise`/`extract`/approve/reject/edit assertions are unchanged — only HOW a draft gets created changes. Add a `waitForTerminal` helper (same shape as `ai-jobs.e2e.spec.ts`'s) and replace every `generateRequest(token).send({...}).expect(201)` + `response.body.created[0].id` pair with: create a job, poll to terminal, read `createdQuestionIds[0]`.

Replace the `generateRequest` helper and the first three `it()` blocks (the ones exercising `/ai/questions/generate` directly) with:

```ts
async function generateOneDraft(token: string): Promise<string> {
  const created = await request(app.getHttpServer())
    .post("/ai/questions/jobs")
    .set("Authorization", `Bearer ${token}`)
    .send({
      courseId,
      topicId,
      difficulty: Difficulty.Easy,
      gradeLevel: "primaria_1",
      count: 1,
      withFigure: false,
    })
    .expect(202);

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const res = await request(app.getHttpServer())
      .get(`/ai/questions/jobs/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    if (res.body.status === "completed") {
      return res.body.createdQuestionIds[0];
    }
    if (res.body.status === "failed") {
      throw new Error("Generation job failed unexpectedly in test setup");
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Generation job did not complete in time");
}

it("generate -> draft -> approve: a valid AI question compiles, saves as draft, and can be approved", async () => {
  app = await buildApp(new ScriptedQuestionGeneratorAdapter([VALID_QUESTION]));

  const id = await generateOneDraft(tenantAToken);
  createdQuestionIds.push(id);

  const fetched = await request(app.getHttpServer())
    .get(`/bank/questions/${id}`)
    .set("Authorization", `Bearer ${tenantAToken}`)
    .expect(200);

  expect(fetched.body.status).toBe("draft");
  expect(fetched.body.aiGenerated).toBe(true);
  expect(fetched.body.type).toBe("structured");
  expect(fetched.body.bodyTypst).toBe(VALID_QUESTION.bodyTypst);
  expect(fetched.body.correctAnswer).toBe("1");

  const drafts = await request(app.getHttpServer())
    .get("/bank/questions")
    .query({ status: "draft" })
    .set("Authorization", `Bearer ${tenantAToken}`)
    .expect(200);
  expect(drafts.body.map((q: { id: string }) => q.id)).toContain(id);

  await request(app.getHttpServer())
    .post(`/bank/questions/${id}/approve`)
    .set("Authorization", `Bearer ${tenantAToken}`)
    .expect(201);

  const approved = await request(app.getHttpServer())
    .get(`/bank/questions/${id}`)
    .set("Authorization", `Bearer ${tenantAToken}`)
    .expect(200);
  expect(approved.body.status).toBe("approved");
});

it("generate -> (invalid Typst markup) -> does NOT save, and the job reports the per-item compile error", async () => {
  app = await buildApp(new ScriptedQuestionGeneratorAdapter([INVALID_TYPST_QUESTION]));

  const created = await request(app.getHttpServer())
    .post("/ai/questions/jobs")
    .set("Authorization", `Bearer ${tenantAToken}`)
    .send({
      courseId,
      topicId,
      difficulty: Difficulty.Easy,
      gradeLevel: "primaria_1",
      count: 1,
      withFigure: false,
    })
    .expect(202);

  const deadline = Date.now() + 15000;
  let final:
    | {
        status: string;
        createdCount: number;
        failedCount: number;
        failedItems: { index: number; error: string }[];
      }
    | undefined;
  while (Date.now() < deadline) {
    const res = await request(app.getHttpServer())
      .get(`/ai/questions/jobs/${created.body.id}`)
      .set("Authorization", `Bearer ${tenantAToken}`);
    if (res.body.status === "completed") {
      final = res.body;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  expect(final).toBeDefined();
  expect(final!.createdCount).toBe(0);
  expect(final!.failedCount).toBe(1);
  expect(final!.failedItems[0]!.error).toContain("Typst compile failed");

  const drafts = await request(app.getHttpServer())
    .get("/bank/questions")
    .query({ status: "draft", topicId })
    .set("Authorization", `Bearer ${tenantAToken}`)
    .expect(200);
  expect(drafts.body).toHaveLength(0);
});

it("persists the requester's tenant on the generated draft — never visible to another tenant", async () => {
  app = await buildApp(new ScriptedQuestionGeneratorAdapter([VALID_QUESTION]));

  const id = await generateOneDraft(tenantAToken);
  createdQuestionIds.push(id);

  await request(app.getHttpServer())
    .get(`/bank/questions/${id}`)
    .set("Authorization", `Bearer ${tenantBToken}`)
    .expect(404);
});
```

Remove the old `rejects with 400 when required fields are missing` and `rejects with 401 when no Authorization header is sent` `it()` blocks entirely — that coverage now lives in `ai-jobs.e2e.spec.ts` (Task 4), which tests `POST /ai/questions/jobs` directly.

For the remaining `it()` blocks (`approve/reject/edit: ...`), replace every occurrence of:

```ts
const response = await generateRequest(tenantAToken)
  .send({ courseId, topicId, difficulty: Difficulty.Easy, gradeLevel: "primaria_1", count: 1 })
  .expect(201);
const id = response.body.created[0].id;
```

with:

```ts
const id = await generateOneDraft(tenantAToken);
```

(Keep every assertion after that line unchanged in each of those four blocks.)

- [ ] **Step 3: Run it, expect pass**

Run: `cd apps/api && pnpm exec jest src/modules/ai/ai.e2e.spec.ts`
Expected: PASS — 7 tests (down from 9; the two moved to `ai-jobs.e2e.spec.ts`).

- [ ] **Step 4: Full API regression check**

Run: `cd apps/api && pnpm exec jest`
Expected: PASS — every suite in the repo.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ai/ai.controller.ts apps/api/src/modules/ai/ai.e2e.spec.ts
git commit -m "refactor(api): remove POST /ai/questions/generate in favor of durable generation jobs"
```

---

## Self-Review Notes

- **Spec coverage:** §3 (schema) → Task 1. §4 (endpoints) → Tasks 3-4. §5 (execution, checkpoint-resume, cancellation) → Task 2. §7 (error handling: sync validation before enqueue, per-item partial failure, cancel semantics) → Tasks 3-4 tests. §9 (out of scope: no SSE, no cross-tenant, no auto-retry-forever) — respected, none of these were built. The frontend (§6) is a separate companion plan.
- **Cross-plan conflict avoided:** confirmed no task in this plan modifies `generate-questions.service.ts`.
- **Type consistency checked:** `GenerationJobData` (processor) matches the payload shape used by `GenerationJobsService.create()`'s `queue.add()` call and by `ai-jobs.e2e.spec.ts`'s assertions. `GenerationJobRecord`/`GenerationJobFailedItem` field names are identical across the repository, service, processor, and every spec file.
