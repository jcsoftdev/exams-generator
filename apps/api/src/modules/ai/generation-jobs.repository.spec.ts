import { randomUUID } from "node:crypto";
import { Difficulty, Role } from "@exams-generator/shared";
import { eq } from "drizzle-orm";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { courses, generationJobs, tenants, topics, users } from "../../db/schema";
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
    // Delete generation_jobs first (they reference topics/courses/users/tenants)
    await db.delete(generationJobs).where(eq(generationJobs.topicId, topicId));
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

  it("list() joins in the course/topic names so the history can show a title", async () => {
    const record = await repository.create(baseInput());

    const { items } = await repository.list(tenantId, 1, 50);

    const item = items.find((i) => i.id === record.id);
    expect(item!.courseName).toContain("GenJobs Course");
    expect(item!.topicName).toContain("GenJobs Topic");
  });

  describe("retry chains", () => {
    it("create() without retriedFromJobId leaves retriedFromJobId/rootJobId null", async () => {
      const record = await repository.create(baseInput());

      expect(record.retriedFromJobId).toBeNull();
      expect(record.rootJobId).toBeNull();
    });

    it("create() with retriedFromJobId links to the parent and roots at the parent itself", async () => {
      const original = await repository.create(baseInput());

      const retry = await repository.create({
        ...baseInput(),
        retriedFromJobId: original.id,
        rootJobId: original.id,
      });

      expect(retry.retriedFromJobId).toBe(original.id);
      expect(retry.rootJobId).toBe(original.id);
    });

    it("list() collapses a multi-attempt chain to only its latest (leaf) job, with attemptCount = chain length", async () => {
      const original = await repository.create(baseInput());
      await repository.setStatus(original.id, "failed");
      const retry1 = await repository.create({ ...baseInput(), retriedFromJobId: original.id, rootJobId: original.id });
      await repository.setStatus(retry1.id, "failed");
      const retry2 = await repository.create({ ...baseInput(), retriedFromJobId: retry1.id, rootJobId: original.id });

      const { items } = await repository.list(tenantId, 1, 50);

      expect(items.find((i) => i.id === original.id)).toBeUndefined();
      expect(items.find((i) => i.id === retry1.id)).toBeUndefined();
      const leaf = items.find((i) => i.id === retry2.id);
      expect(leaf).toBeDefined();
      expect(leaf!.attemptCount).toBe(3);
    });

    it("list() reports attemptCount 1 for a job that was never retried", async () => {
      const solo = await repository.create(baseInput());

      const { items } = await repository.list(tenantId, 1, 50);

      expect(items.find((i) => i.id === solo.id)!.attemptCount).toBe(1);
    });

    it("listChain() returns every attempt in the chain, oldest first, given any job in the chain", async () => {
      const original = await repository.create(baseInput());
      await repository.setStatus(original.id, "failed");
      const retry1 = await repository.create({ ...baseInput(), retriedFromJobId: original.id, rootJobId: original.id });
      await repository.setStatus(retry1.id, "failed");
      const retry2 = await repository.create({ ...baseInput(), retriedFromJobId: retry1.id, rootJobId: original.id });

      const chain = await repository.listChain(tenantId, original.id);

      expect(chain.map((r) => r.id)).toEqual([original.id, retry1.id, retry2.id]);
    });
  });
});
