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

  it("creates the row then enqueues a BullMQ job keyed by the row id", async () => {
    const { service, repository, queue } = buildDeps();

    const record = await service.create(TEACHER, VALID_DTO);

    expect(record).toBe(JOB_RECORD);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", createdBy: "user-1", createdByRole: Role.Teacher, count: 5 }),
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
