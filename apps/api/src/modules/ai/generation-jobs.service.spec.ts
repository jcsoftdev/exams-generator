import { Difficulty, Role } from "@exams-generator/shared";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { BankRepository } from "../bank/bank.repository";
import { GenerationJobsRepository } from "./generation-jobs.repository";
import { GenerationJobsService, MAX_ACTIVE_JOBS_PER_TENANT } from "./generation-jobs.service";

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
  retriedFromJobId: null as string | null,
  rootJobId: null as string | null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null as string | null,
};

function buildDeps() {
  const repository = {
    create: jest.fn().mockResolvedValue(JOB_RECORD),
    countActiveByTenant: jest.fn().mockResolvedValue(0),
    getById: jest.fn().mockResolvedValue(JOB_RECORD),
    list: jest
      .fn()
      .mockResolvedValue({ items: [{ ...JOB_RECORD, attemptCount: 1, courseName: "Matemática", topicName: "Fracciones" }], total: 1 }),
    listChain: jest.fn().mockResolvedValue([JOB_RECORD]),
    requestCancel: jest.fn().mockResolvedValue(undefined),
    setStatus: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<GenerationJobsRepository>;

  const bankRepository = {
    findCourseAndTopicNames: jest.fn().mockResolvedValue({ courseName: "Matemática", topicName: "Fracciones" }),
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

  /**
   * Audit 2026-08-18 (Cost/Abuse): each job is up to 10 OpenRouter calls, and
   * nothing capped how many an authenticated user could pile up — the global
   * 100 req/min throttle plus worker concurrency:2 slows the SPEND RATE but not
   * the total. A runaway account enqueues thousands of jobs, all billed. A
   * per-tenant active-job ceiling bounds the queue depth.
   */
  it("rejects (429, no enqueue) when the tenant already has too many active jobs", async () => {
    const { service, repository, queue } = buildDeps();
    (repository.countActiveByTenant as jest.Mock).mockResolvedValue(MAX_ACTIVE_JOBS_PER_TENANT);

    await expect(service.create(TEACHER, VALID_DTO)).rejects.toMatchObject({ status: 429 });
    expect(repository.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("allows creation right below the ceiling", async () => {
    const { service, repository, queue } = buildDeps();
    (repository.countActiveByTenant as jest.Mock).mockResolvedValue(MAX_ACTIVE_JOBS_PER_TENANT - 1);

    await service.create(TEACHER, VALID_DTO);
    expect(repository.create).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalled();
  });

  it("creates the row then enqueues a BullMQ job keyed by the row id", async () => {
    const { service, repository, queue } = buildDeps();

    const record = await service.create(TEACHER, VALID_DTO);

    expect(record).toBe(JOB_RECORD);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", createdBy: "user-1", createdByRole: Role.Teacher, count: 5 }),
    );
    expect(queue.add).toHaveBeenCalledWith("generate", { jobId: "job-1" }, { jobId: "job-1" });
  });

  it("marks the row failed and re-throws the original error when enqueueing to Redis fails", async () => {
    const { service, repository, queue } = buildDeps();
    const enqueueError = new Error("Redis unreachable");
    queue.add.mockRejectedValue(enqueueError);

    await expect(service.create(TEACHER, VALID_DTO)).rejects.toBe(enqueueError);

    expect(repository.setStatus).toHaveBeenCalledWith("job-1", "failed");
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

describe("GenerationJobsService.create — retry linkage", () => {
  it("rejects with NotFoundException (no enqueue) when retriedFromJobId doesn't resolve for this tenant", async () => {
    const { service, repository, queue } = buildDeps();
    repository.getById.mockResolvedValue(undefined);

    await expect(service.create(TEACHER, { ...VALID_DTO, retriedFromJobId: "missing-job" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("roots at the parent itself when the parent was never a retry", async () => {
    const { service, repository } = buildDeps();
    repository.getById.mockResolvedValue({ ...JOB_RECORD, id: "parent-1", rootJobId: null });

    await service.create(TEACHER, { ...VALID_DTO, retriedFromJobId: "parent-1" });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ retriedFromJobId: "parent-1", rootJobId: "parent-1" }),
    );
  });

  it("carries the chain's original rootJobId forward when the parent was itself already a retry", async () => {
    const { service, repository } = buildDeps();
    repository.getById.mockResolvedValue({ ...JOB_RECORD, id: "parent-2", rootJobId: "original-job" });

    await service.create(TEACHER, { ...VALID_DTO, retriedFromJobId: "parent-2" });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ retriedFromJobId: "parent-2", rootJobId: "original-job" }),
    );
  });

  it("leaves retriedFromJobId/rootJobId unset for a regular (non-retry) create", async () => {
    const { service, repository } = buildDeps();

    await service.create(TEACHER, VALID_DTO);

    expect(repository.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ retriedFromJobId: expect.anything() }),
    );
  });
});

describe("GenerationJobsService.getChain", () => {
  it("throws NotFoundException when the job doesn't exist for this tenant", async () => {
    const { service, repository } = buildDeps();
    repository.getById.mockResolvedValue(undefined);

    await expect(service.getChain(TEACHER, "job-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("resolves the chain at the job's own id when it has no rootJobId (it IS the root)", async () => {
    const { service, repository } = buildDeps();
    repository.getById.mockResolvedValue({ ...JOB_RECORD, id: "job-1", rootJobId: null });

    await service.getChain(TEACHER, "job-1");

    expect(repository.listChain).toHaveBeenCalledWith("tenant-1", "job-1");
  });

  it("resolves the chain at rootJobId when the job is itself a retry", async () => {
    const { service, repository } = buildDeps();
    repository.getById.mockResolvedValue({ ...JOB_RECORD, id: "job-3", rootJobId: "original-job" });

    await service.getChain(TEACHER, "job-3");

    expect(repository.listChain).toHaveBeenCalledWith("tenant-1", "original-job");
  });
});
