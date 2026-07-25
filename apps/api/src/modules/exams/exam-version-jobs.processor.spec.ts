import { Role } from "@exams-generator/shared";
import { Job } from "bullmq";
import { Logger } from "nestjs-pino";
import { ExamPdfGenerationError, ExamVersionGenerationService, GeneratedVersionResult } from "./exam-generation.service";
import { ExamVersionJobEventsService } from "./exam-version-job-events.service";
import { ExamVersionJobsProcessor } from "./exam-version-jobs.processor";
import { ExamVersionJobsRepository } from "./exam-version-jobs.repository";

const BASE_RECORD = {
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

function result(code: string): GeneratedVersionResult {
  return { code, pdfUrl: `/assets/${code}-pdf`, answerSheetUrl: `/assets/${code}-key` };
}

function buildDeps() {
  const repository = {
    getByIdUnscoped: jest.fn().mockResolvedValue(BASE_RECORD),
    startAttempt: jest.fn().mockResolvedValue(undefined),
    setStatus: jest.fn().mockResolvedValue(undefined),
    incrementCompleted: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ExamVersionJobsRepository>;

  const generationService = {
    generateVersions: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<ExamVersionGenerationService>;

  const events = { notify: jest.fn() } as unknown as jest.Mocked<ExamVersionJobEventsService>;
  const logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() } as unknown as Logger;

  const processor = new ExamVersionJobsProcessor(repository, generationService, events, logger);
  return { processor, repository, generationService, events, logger };
}

function job(jobId: string): Job<{ jobId: string }> {
  return { data: { jobId } } as Job<{ jobId: string }>;
}

function failedJob(jobId: string, attemptsMade: number, attempts: number): Job<{ jobId: string }> {
  return { data: { jobId }, attemptsMade, opts: { attempts }, failedReason: "boom" } as Job<{ jobId: string }>;
}

describe("ExamVersionJobsProcessor.process", () => {
  it("runs generation for the job's exam, rebuilding the worker's auth context from the row alone", async () => {
    const { processor, generationService } = buildDeps();

    await processor.process(job("job-1"));

    expect(generationService.generateVersions).toHaveBeenCalledWith(
      { sub: "user-1", tenantId: "tenant-1", role: Role.Teacher },
      "exam-1",
      3,
      expect.any(Function),
    );
  });

  it("starts each attempt from zero progress, then completes", async () => {
    const { processor, repository, events } = buildDeps();

    await processor.process(job("job-1"));

    expect(repository.startAttempt).toHaveBeenCalledWith("job-1");
    expect(repository.setStatus).toHaveBeenCalledWith("job-1", "completed");
    expect(events.notify).toHaveBeenCalledWith("job-1");
  });

  it("bumps the progress counter once per generated form and pushes an event each time", async () => {
    const { processor, repository, generationService, events } = buildDeps();
    generationService.generateVersions.mockImplementation(async (_user, _examId, count, onCompleted) => {
      const results: GeneratedVersionResult[] = [];
      for (let i = 0; i < count; i += 1) {
        const r = result(String.fromCharCode(65 + i));
        results.push(r);
        await onCompleted?.(r);
      }
      return results;
    });

    await processor.process(job("job-1"));

    expect(repository.incrementCompleted).toHaveBeenCalledTimes(3);
    // 1 for "running" + 3 progress + 1 terminal.
    expect(events.notify).toHaveBeenCalledTimes(5);
  });

  it("does nothing for an unknown job", async () => {
    const { processor, repository, generationService } = buildDeps();
    repository.getByIdUnscoped.mockResolvedValue(undefined);

    await processor.process(job("job-1"));

    expect(generationService.generateVersions).not.toHaveBeenCalled();
    expect(repository.startAttempt).not.toHaveBeenCalled();
  });

  it("does nothing for an already-terminal job — a redelivered message never regenerates finished work", async () => {
    const { processor, repository, generationService } = buildDeps();
    repository.getByIdUnscoped.mockResolvedValue({ ...BASE_RECORD, status: "completed" });

    await processor.process(job("job-1"));

    expect(generationService.generateVersions).not.toHaveBeenCalled();
  });

  it("resolves a Typst content failure terminally, keeping the forms that did generate", async () => {
    const { processor, repository, generationService, events } = buildDeps();
    generationService.generateVersions.mockImplementation(async (_user, _examId, _count, onCompleted) => {
      await onCompleted?.(result("A"));
      throw new ExamPdfGenerationError("exam-1", "question-9", "invalid figure code");
    });

    // Must NOT rethrow: retrying recompiles the same broken question with
    // the same result, burning the whole backoff budget for nothing.
    await expect(processor.process(job("job-1"))).resolves.toBeUndefined();

    expect(repository.incrementCompleted).toHaveBeenCalledTimes(1);
    expect(repository.markFailed).toHaveBeenCalledWith("job-1", {
      reason: "invalid figure code",
      questionId: "question-9",
    });
    expect(repository.setStatus).not.toHaveBeenCalledWith("job-1", "completed");
    expect(events.notify).toHaveBeenLastCalledWith("job-1");
  });

  it("rethrows a transient failure so BullMQ retries it", async () => {
    const { processor, repository, generationService } = buildDeps();
    generationService.generateVersions.mockRejectedValue(new Error("MinIO unreachable"));

    await expect(processor.process(job("job-1"))).rejects.toThrow("MinIO unreachable");
    expect(repository.markFailed).not.toHaveBeenCalled();
  });
});

describe("ExamVersionJobsProcessor.onFailed", () => {
  it("ignores an intermediate retry — the job is not terminal while BullMQ still has attempts left", async () => {
    const { processor, repository } = buildDeps();

    await processor.onFailed(failedJob("job-1", 1, 3));

    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it("marks the row failed once the retries are exhausted", async () => {
    const { processor, repository, logger } = buildDeps();

    await processor.onFailed(failedJob("job-1", 3, 3));

    expect(repository.markFailed).toHaveBeenCalledWith("job-1", { reason: "boom" });
    expect(logger.error).toHaveBeenCalled();
  });

  it("leaves an already-terminal row alone", async () => {
    const { processor, repository } = buildDeps();
    repository.getByIdUnscoped.mockResolvedValue({ ...BASE_RECORD, status: "failed" });

    await processor.onFailed(failedJob("job-1", 3, 3));

    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it("tolerates an undefined job (stalled and removed before the event fired)", async () => {
    const { processor, repository } = buildDeps();

    await processor.onFailed(undefined);

    expect(repository.markFailed).not.toHaveBeenCalled();
  });
});
