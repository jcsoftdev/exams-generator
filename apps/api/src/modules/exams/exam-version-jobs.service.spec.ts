import { Role } from "@exams-generator/shared";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { ExamVersionGenerationService } from "./exam-generation.service";
import { ExamVersionJobsRepository } from "./exam-version-jobs.repository";
import { ExamVersionJobsService } from "./exam-version-jobs.service";

const TEACHER: AuthTokenPayload = { sub: "user-1", tenantId: "tenant-1", role: Role.Teacher };

const JOB_RECORD = {
  id: "job-1",
  tenantId: "tenant-1",
  examId: "exam-1",
  createdBy: "user-1",
  createdByRole: Role.Teacher,
  versionCount: 3,
  status: "pending" as const,
  completedCount: 0,
  failedReason: null as string | null,
  failedQuestionId: null as string | null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null as string | null,
};

function buildDeps() {
  const repository = {
    create: jest.fn().mockResolvedValue(JOB_RECORD),
    getById: jest.fn().mockResolvedValue(JOB_RECORD),
    getLatestForExam: jest.fn().mockResolvedValue(JOB_RECORD),
    setStatus: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ExamVersionJobsRepository>;

  const generationService = {
    prepareGeneration: jest.fn().mockResolvedValue({ id: "exam-1", tenantId: "tenant-1" }),
  } as unknown as jest.Mocked<ExamVersionGenerationService>;

  const queue = { add: jest.fn().mockResolvedValue(undefined) };

  const service = new ExamVersionJobsService(repository, generationService, queue as never);
  return { service, repository, generationService, queue };
}

describe("ExamVersionJobsService.create", () => {
  it("validates synchronously BEFORE enqueuing — a rejected exam never reaches the queue", async () => {
    const { service, generationService, repository, queue } = buildDeps();
    generationService.prepareGeneration.mockRejectedValue(
      new ConflictException("Exam has no selected questions"),
    );

    await expect(service.create(TEACHER, "exam-1", 3)).rejects.toBeInstanceOf(ConflictException);
    expect(repository.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("persists a pending job and enqueues it keyed by its own id", async () => {
    const { service, repository, queue } = buildDeps();

    const record = await service.create(TEACHER, "exam-1", 3);

    expect(record).toEqual(JOB_RECORD);
    expect(repository.create).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      examId: "exam-1",
      createdBy: "user-1",
      createdByRole: Role.Teacher,
      versionCount: 3,
    });
    // `jobId: record.id` makes the enqueue idempotent — a retried HTTP call
    // that somehow reuses the row can never produce two BullMQ jobs for it.
    expect(queue.add).toHaveBeenCalledWith("generate-versions", { jobId: "job-1" }, { jobId: "job-1" });
  });

  it("marks the row failed (and rethrows) when the enqueue itself fails", async () => {
    const { service, repository, queue } = buildDeps();
    (queue.add as jest.Mock).mockRejectedValue(new Error("Redis down"));

    await expect(service.create(TEACHER, "exam-1", 3)).rejects.toThrow("Redis down");
    // Otherwise the row is stranded at "pending" forever with nothing to
    // process it — same reasoning as GenerationJobsService.create().
    expect(repository.setStatus).toHaveBeenCalledWith("job-1", "failed");
  });
});

describe("ExamVersionJobsService.get", () => {
  it("returns the tenant-scoped job", async () => {
    const { service, repository } = buildDeps();

    await expect(service.get(TEACHER, "job-1")).resolves.toEqual(JOB_RECORD);
    expect(repository.getById).toHaveBeenCalledWith("job-1", "tenant-1");
  });

  it("404s an unknown or cross-tenant job", async () => {
    const { service, repository } = buildDeps();
    repository.getById.mockResolvedValue(undefined);

    await expect(service.get(TEACHER, "job-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects platform staff (no tenant)", async () => {
    const { service } = buildDeps();

    await expect(
      service.get({ sub: "s-1", tenantId: null, role: Role.ContentEditor }, "job-1"),
    ).rejects.toThrow();
  });
});

describe("ExamVersionJobsService.getLatestForExam", () => {
  it("returns the newest job so a reloaded page can re-attach to an in-flight generation", async () => {
    const { service, repository } = buildDeps();

    await expect(service.getLatestForExam(TEACHER, "exam-1")).resolves.toEqual(JOB_RECORD);
    expect(repository.getLatestForExam).toHaveBeenCalledWith("exam-1", "tenant-1");
  });

  it("returns null (not 404) when the exam has never been generated — that is a valid state, not an error", async () => {
    const { service, repository } = buildDeps();
    repository.getLatestForExam.mockResolvedValue(undefined);

    await expect(service.getLatestForExam(TEACHER, "exam-1")).resolves.toBeNull();
  });
});
