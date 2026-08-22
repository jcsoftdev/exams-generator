import { randomUUID } from "node:crypto";
import { Role } from "@exams-generator/shared";
import { eq } from "drizzle-orm";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { examVersionJobs, exams, tenants, users } from "../../db/schema";
import { ExamVersionJobsRepository } from "./exam-version-jobs.repository";

/** Integration test against the real docker-compose Postgres — same pattern as `generation-jobs.repository.spec.ts`. */
describe("ExamVersionJobsRepository", () => {
  const repository = new ExamVersionJobsRepository();

  let tenantId: string;
  let otherTenantId: string;
  let userId: string;
  let examId: string;
  let otherExamId: string;

  beforeAll(async () => {
    await runMigrations();

    const suffix = randomUUID();

    const [tenant] = await db
      .insert(tenants)
      .values({ name: `VerJobs Tenant ${suffix}`, slug: `verjobs-tenant-${suffix}` })
      .returning({ id: tenants.id });
    tenantId = tenant!.id;

    const [otherTenant] = await db
      .insert(tenants)
      .values({ name: `VerJobs Other ${suffix}`, slug: `verjobs-other-${suffix}` })
      .returning({ id: tenants.id });
    otherTenantId = otherTenant!.id;

    const [user] = await db
      .insert(users)
      .values({
        tenantId,
        email: `verjobs-user-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    userId = user!.id;

    const [exam] = await db
      .insert(exams)
      .values({ tenantId, title: `VerJobs Exam ${suffix}`, gradeLevel: "primaria_1", createdBy: userId })
      .returning({ id: exams.id });
    examId = exam!.id;

    const [otherExam] = await db
      .insert(exams)
      .values({
        tenantId,
        title: `VerJobs Other Exam ${suffix}`,
        gradeLevel: "primaria_1",
        createdBy: userId,
      })
      .returning({ id: exams.id });
    otherExamId = otherExam!.id;
  });

  afterAll(async () => {
    await db.delete(examVersionJobs).where(eq(examVersionJobs.examId, examId));
    await db.delete(examVersionJobs).where(eq(examVersionJobs.examId, otherExamId));
    await db.delete(exams).where(eq(exams.id, examId));
    await db.delete(exams).where(eq(exams.id, otherExamId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await pool.end();
  });

  function baseInput(overrides: Partial<Parameters<ExamVersionJobsRepository["create"]>[0]> = {}) {
    return {
      tenantId,
      examId,
      createdBy: userId,
      createdByRole: Role.Teacher,
      versionCount: 3,
      ...overrides,
    };
  }

  it("create() persists a pending job with a zeroed progress counter", async () => {
    const record = await repository.create(baseInput());

    expect(record.status).toBe("pending");
    expect(record.completedCount).toBe(0);
    expect(record.versionCount).toBe(3);
    expect(record.examId).toBe(examId);
    expect(record.failedReason).toBeNull();
    expect(record.failedQuestionId).toBeNull();
    expect(record.completedAt).toBeNull();
  });

  it("getById() is tenant-scoped — another tenant never sees the job", async () => {
    const record = await repository.create(baseInput());

    expect(await repository.getById(record.id, tenantId)).toMatchObject({ id: record.id });
    expect(await repository.getById(record.id, otherTenantId)).toBeUndefined();
  });

  it("getByIdUnscoped() resolves without a tenant — the worker has no request context", async () => {
    const record = await repository.create(baseInput());

    expect(await repository.getByIdUnscoped(record.id)).toMatchObject({ id: record.id, examId });
  });

  it("incrementCompleted() bumps the counter atomically, one form at a time", async () => {
    const record = await repository.create(baseInput());

    await repository.incrementCompleted(record.id);
    await repository.incrementCompleted(record.id);

    expect((await repository.getByIdUnscoped(record.id))!.completedCount).toBe(2);
  });

  it("startAttempt() zeroes progress and clears prior failure detail — a retry regenerates from scratch", async () => {
    const record = await repository.create(baseInput());
    await repository.incrementCompleted(record.id);
    await repository.markFailed(record.id, { reason: "first attempt blew up", questionId: "q-7" });

    await repository.startAttempt(record.id);

    const retried = (await repository.getByIdUnscoped(record.id))!;
    expect(retried.status).toBe("running");
    expect(retried.completedCount).toBe(0);
    expect(retried.failedReason).toBeNull();
    expect(retried.failedQuestionId).toBeNull();
  });

  it("setStatus('completed') stamps completedAt; 'running' does not", async () => {
    const record = await repository.create(baseInput());

    await repository.setStatus(record.id, "running");
    expect((await repository.getByIdUnscoped(record.id))!.completedAt).toBeNull();

    await repository.setStatus(record.id, "completed");
    expect((await repository.getByIdUnscoped(record.id))!.completedAt).not.toBeNull();
  });

  it("markFailed() keeps the partial progress and records why it stopped", async () => {
    const record = await repository.create(baseInput());
    await repository.incrementCompleted(record.id);

    await repository.markFailed(record.id, { reason: "Typst exploded", questionId: "q-42" });

    const failed = (await repository.getByIdUnscoped(record.id))!;
    expect(failed.status).toBe("failed");
    // The whole point of the partial-failure contract: the forms that DID
    // generate stay accounted for instead of being reported as zero.
    expect(failed.completedCount).toBe(1);
    expect(failed.failedReason).toBe("Typst exploded");
    expect(failed.failedQuestionId).toBe("q-42");
    expect(failed.completedAt).not.toBeNull();
  });

  it("markFailed() tolerates a failure the compiler could not trace to a question", async () => {
    const record = await repository.create(baseInput());

    await repository.markFailed(record.id, { reason: "Redis went away" });

    const failed = (await repository.getByIdUnscoped(record.id))!;
    expect(failed.failedQuestionId).toBeNull();
    expect(failed.failedReason).toBe("Redis went away");
  });

  it("getLatestForExam() returns the newest job for that exam, tenant-scoped", async () => {
    const older = await repository.create(baseInput({ examId: otherExamId, versionCount: 2 }));
    await repository.setStatus(older.id, "completed");
    const newer = await repository.create(baseInput({ examId: otherExamId, versionCount: 5 }));

    expect(await repository.getLatestForExam(otherExamId, tenantId)).toMatchObject({ id: newer.id });
    expect(await repository.getLatestForExam(otherExamId, otherTenantId)).toBeUndefined();
  });
});
