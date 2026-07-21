import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Role } from "@exams-generator/shared";
import { Job } from "bullmq";
import { AuthTokenPayload } from "../auth/token.service";
import { GenerateQuestionsService } from "./generate-questions.service";
import { GenerationJobEventsService } from "./generation-job-events.service";
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
    private readonly events: GenerationJobEventsService,
  ) {
    super();
  }

  async process(job: Job<GenerationJobData>): Promise<void> {
    const record = await this.repository.getByIdUnscoped(job.data.jobId);
    if (!record || TERMINAL_STATUSES.includes(record.status)) {
      return;
    }

    await this.repository.setStatus(record.id, "running");
    this.events.notify(record.id);

    const user: AuthTokenPayload = {
      sub: record.createdBy,
      tenantId: record.tenantId,
      role: record.createdByRole as Role,
    };

    const startIndex = record.createdCount + record.failedCount;

    for (let index = startIndex; index < record.count; index += 1) {
      if (await this.repository.isCancelRequested(record.id)) {
        await this.repository.setStatus(record.id, "cancelled");
        this.events.notify(record.id);
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
      this.events.notify(record.id);
    }

    await this.repository.setStatus(record.id, "completed");
    this.events.notify(record.id);
  }

  /**
   * BullMQ emits `failed` once per attempt, including intermediate retries.
   * Only the FINAL exhausted failure (attemptsMade >= configured attempts)
   * should resolve the job row to `status='failed'` — otherwise a job still
   * mid-retry (e.g. attempt 1 of 3) would be wrongly marked terminal while
   * BullMQ is about to try again. `job` can be `undefined` per BullMQ's own
   * typing (stalled job removed via `removeOnFail` before this fires).
   */
  @OnWorkerEvent("failed")
  async onFailed(job: Job<GenerationJobData> | undefined): Promise<void> {
    if (!job) {
      return;
    }

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      return;
    }

    const record = await this.repository.getByIdUnscoped(job.data.jobId);
    if (!record || TERMINAL_STATUSES.includes(record.status)) {
      return;
    }

    await this.repository.setStatus(record.id, "failed");
    this.events.notify(record.id);
  }
}
