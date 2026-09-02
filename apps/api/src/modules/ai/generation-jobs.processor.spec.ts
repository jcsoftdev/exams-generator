import { Difficulty, Role } from "@exams-generator/shared";
import { Job } from "bullmq";
import { Logger } from "nestjs-pino";
import { GenerateQuestionsService } from "./generate-questions.service";
import { GenerationJobEventsService } from "./generation-job-events.service";
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
  retriedFromJobId: null as string | null,
  rootJobId: null as string | null,
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

  const events = { notify: jest.fn() } as unknown as jest.Mocked<GenerationJobEventsService>;
  const logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() } as unknown as Logger;

  const processor = new GenerationJobsProcessor(repository, generateQuestionsService, events, logger);
  return { processor, repository, generateQuestionsService, events, logger };
}

function job(jobId: string): Job<{ jobId: string }> {
  return { data: { jobId } } as Job<{ jobId: string }>;
}

function failedJob(jobId: string, attemptsMade: number, attempts: number): Job<{ jobId: string }> {
  return { data: { jobId }, attemptsMade, opts: { attempts } } as Job<{ jobId: string }>;
}

describe("GenerationJobsProcessor", () => {
  it("calls generateQuestions once per item (count:1) and appends each created id", async () => {
    const { processor, repository, generateQuestionsService, events } = buildDeps();
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
    // One notify per item plus the final "completed" — proves the SSE
    // endpoint gets pushed live progress, not just a terminal event.
    expect(events.notify).toHaveBeenCalledTimes(5);
    expect(events.notify).toHaveBeenCalledWith("job-1");
  });

  it("records a per-item failure with the correct batch index, not the inner call's index:0", async () => {
    const { processor, repository, generateQuestionsService } = buildDeps();
    // resumed job: startIndex = 2 + 1 = 3, so loop starts at index 3
    repository.getByIdUnscoped.mockResolvedValue({
      ...BASE_RECORD,
      count: 5,
      createdCount: 2,
      failedCount: 1,
      status: "running",
    });
    generateQuestionsService.generateQuestions
      // First call (at loop index 3): fails with inner index 0; we must record batch index 3, not 0
      .mockResolvedValueOnce({ created: [], failed: [{ index: 0, error: "Typst compile failed" }] })
      // Second call (at loop index 4): succeeds
      .mockResolvedValueOnce({ created: [{ id: "q5" }], failed: [] });

    await processor.process(job("job-1"));

    // Proves we use the loop's own index (3), not result.failed[0].index (0)
    expect(repository.appendFailedItem).toHaveBeenCalledWith("job-1", {
      index: 3,
      error: "Typst compile failed",
    });
    expect(repository.appendCreatedQuestion).toHaveBeenCalledWith("job-1", "q5");
  });

  it('forwards code: "ai_not_configured" onto the job\'s failed item, so the history UI can distinguish it from a transient failure', async () => {
    const { processor, repository, generateQuestionsService } = buildDeps();
    repository.getByIdUnscoped.mockResolvedValue({
      ...BASE_RECORD,
      count: 1,
      createdCount: 0,
      failedCount: 0,
      status: "pending",
    });
    generateQuestionsService.generateQuestions.mockResolvedValueOnce({
      created: [],
      failed: [{ index: 0, error: "AI_MODEL env var is not set.", code: "ai_not_configured" }],
    });

    await processor.process(job("job-1"));

    expect(repository.appendFailedItem).toHaveBeenCalledWith("job-1", {
      index: 0,
      error: "AI_MODEL env var is not set.",
      code: "ai_not_configured",
    });
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
    const { processor, repository, generateQuestionsService, events } = buildDeps();
    repository.getByIdUnscoped.mockResolvedValue({
      ...BASE_RECORD,
      count: 3,
      createdCount: 0,
      failedCount: 0,
      status: "pending",
    });
    repository.isCancelRequested.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    generateQuestionsService.generateQuestions.mockResolvedValueOnce({ created: [{ id: "q1" }], failed: [] });

    await processor.process(job("job-1"));

    expect(generateQuestionsService.generateQuestions).toHaveBeenCalledTimes(1);
    expect(repository.setStatus).toHaveBeenCalledWith("job-1", "cancelled");
    expect(repository.setStatus).not.toHaveBeenCalledWith("job-1", "completed");
    expect(events.notify).toHaveBeenCalledWith("job-1");
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

describe("GenerationJobsProcessor - @OnWorkerEvent('failed')", () => {
  it("marks the job failed once BullMQ has exhausted all configured attempts", async () => {
    const { processor, repository, events } = buildDeps();
    repository.getByIdUnscoped.mockResolvedValue({
      ...BASE_RECORD,
      count: 3,
      createdCount: 0,
      failedCount: 0,
      status: "running",
    });

    await processor.onFailed(failedJob("job-1", 3, 3));

    expect(repository.setStatus).toHaveBeenCalledWith("job-1", "failed");
    expect(events.notify).toHaveBeenCalledWith("job-1");
  });

  it("does NOT mark the job failed while attempts remain (mid-retry, not exhausted yet)", async () => {
    const { processor, repository, events } = buildDeps();
    repository.getByIdUnscoped.mockResolvedValue({
      ...BASE_RECORD,
      count: 3,
      createdCount: 0,
      failedCount: 0,
      status: "running",
    });

    await processor.onFailed(failedJob("job-1", 1, 3));

    expect(repository.setStatus).not.toHaveBeenCalledWith("job-1", "failed");
    expect(events.notify).not.toHaveBeenCalled();
  });

  it("does NOT overwrite an already-terminal job (e.g. cancelled) when the failed event fires", async () => {
    const { processor, repository, events } = buildDeps();
    repository.getByIdUnscoped.mockResolvedValue({
      ...BASE_RECORD,
      count: 3,
      createdCount: 0,
      failedCount: 0,
      status: "cancelled",
    });

    await processor.onFailed(failedJob("job-1", 3, 3));

    expect(repository.setStatus).not.toHaveBeenCalled();
    expect(events.notify).not.toHaveBeenCalled();
  });
});
