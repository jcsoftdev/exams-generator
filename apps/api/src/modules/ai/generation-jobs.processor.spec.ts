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
    repository.getByIdUnscoped.mockResolvedValue({ ...BASE_RECORD, count: 3, createdCount: 0, failedCount: 0, status: "pending" });
    generateQuestionsService.generateQuestions
      .mockResolvedValueOnce({ created: [{ id: "q1" }], failed: [] })
      .mockResolvedValueOnce({ created: [{ id: "q2" }], failed: [] })
      .mockResolvedValueOnce({ created: [{ id: "q3" }], failed: [] });

    await processor.process(job("job-1"));

    expect(generateQuestionsService.generateQuestions).toHaveBeenCalledTimes(3);
    expect(generateQuestionsService.generateQuestions).toHaveBeenCalledWith(
      { sub: "user-1", tenantId: "tenant-1", role: Role.Teacher },
      { courseId: "course-1", topicId: "topic-1", difficulty: Difficulty.Easy, gradeLevel: "primaria_1", count: 1, withFigure: false },
    );
    expect(repository.appendCreatedQuestion).toHaveBeenNthCalledWith(1, "job-1", "q1");
    expect(repository.appendCreatedQuestion).toHaveBeenNthCalledWith(3, "job-1", "q3");
    expect(repository.setStatus).toHaveBeenCalledWith("job-1", "running");
    expect(repository.setStatus).toHaveBeenCalledWith("job-1", "completed");
  });

  it("records a per-item failure with the correct batch index, not the inner call's index:0", async () => {
    const { processor, repository, generateQuestionsService } = buildDeps();
    // resumed job: startIndex = 2 + 1 = 3, so loop starts at index 3
    repository.getByIdUnscoped.mockResolvedValue({ ...BASE_RECORD, count: 5, createdCount: 2, failedCount: 1, status: "running" });
    generateQuestionsService.generateQuestions
      // First call (at loop index 3): fails with inner index 0; we must record batch index 3, not 0
      .mockResolvedValueOnce({ created: [], failed: [{ index: 0, error: "Typst compile failed" }] })
      // Second call (at loop index 4): succeeds
      .mockResolvedValueOnce({ created: [{ id: "q5" }], failed: [] });

    await processor.process(job("job-1"));

    // Proves we use the loop's own index (3), not result.failed[0].index (0)
    expect(repository.appendFailedItem).toHaveBeenCalledWith("job-1", { index: 3, error: "Typst compile failed" });
    expect(repository.appendCreatedQuestion).toHaveBeenCalledWith("job-1", "q5");
  });

  it("resumes from createdCount + failedCount instead of restarting at 0 (checkpoint-resume)", async () => {
    const { processor, repository, generateQuestionsService } = buildDeps();
    repository.getByIdUnscoped.mockResolvedValue({ ...BASE_RECORD, count: 5, createdCount: 2, failedCount: 1, status: "running" });
    generateQuestionsService.generateQuestions
      .mockResolvedValueOnce({ created: [{ id: "q4" }], failed: [] })
      .mockResolvedValueOnce({ created: [{ id: "q5" }], failed: [] });

    await processor.process(job("job-1"));

    expect(generateQuestionsService.generateQuestions).toHaveBeenCalledTimes(2);
    expect(repository.appendFailedItem).not.toHaveBeenCalled();
  });

  it("stops cooperatively when cancelRequested flips true between items, and marks the job cancelled", async () => {
    const { processor, repository, generateQuestionsService } = buildDeps();
    repository.getByIdUnscoped.mockResolvedValue({ ...BASE_RECORD, count: 3, createdCount: 0, failedCount: 0, status: "pending" });
    repository.isCancelRequested.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    generateQuestionsService.generateQuestions.mockResolvedValueOnce({ created: [{ id: "q1" }], failed: [] });

    await processor.process(job("job-1"));

    expect(generateQuestionsService.generateQuestions).toHaveBeenCalledTimes(1);
    expect(repository.setStatus).toHaveBeenCalledWith("job-1", "cancelled");
    expect(repository.setStatus).not.toHaveBeenCalledWith("job-1", "completed");
  });

  it("no-ops when the job row is missing or already terminal", async () => {
    const { processor, repository, generateQuestionsService } = buildDeps();
    repository.getByIdUnscoped.mockResolvedValue({ ...BASE_RECORD, count: 3, createdCount: 0, failedCount: 0, status: "completed" });

    await processor.process(job("job-1"));

    expect(generateQuestionsService.generateQuestions).not.toHaveBeenCalled();
    expect(repository.setStatus).not.toHaveBeenCalled();
  });
});
