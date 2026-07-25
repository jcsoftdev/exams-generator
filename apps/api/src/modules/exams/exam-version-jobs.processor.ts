import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Role } from "@exams-generator/shared";
import { Job } from "bullmq";
import { Logger } from "nestjs-pino";
import { AuthTokenPayload } from "../auth/token.service";
import { GenerationJobStatus } from "../../db/schema/enums";
import { ExamPdfGenerationError, ExamVersionGenerationService } from "./exam-generation.service";
import { ExamVersionJobEventsService } from "./exam-version-job-events.service";
import { ExamVersionJobsRepository } from "./exam-version-jobs.repository";

export interface ExamVersionJobData {
  readonly jobId: string;
}

const TERMINAL_STATUSES: readonly GenerationJobStatus[] = ["completed", "failed", "cancelled"];

/**
 * BullMQ worker for the `exam-versions` queue (audit P0 — PDF compilation
 * used to block the HTTP request). Reuses
 * `ExamVersionGenerationService.generateVersions()` unmodified apart from its
 * progress callback, so the generation logic has exactly one implementation.
 *
 * `concurrency: 1`, deliberately lower than the `generation` queue's 2: each
 * job spawns `typst` subprocesses that are CPU-bound (the AI queue's work is
 * I/O-bound waiting on OpenRouter), and two concurrent multi-version compiles
 * on a single-container deployment would contend for the same cores and slow
 * both down rather than finishing either sooner.
 */
@Processor("exam-versions", { concurrency: 1 })
export class ExamVersionJobsProcessor extends WorkerHost {
  constructor(
    private readonly repository: ExamVersionJobsRepository,
    private readonly generationService: ExamVersionGenerationService,
    private readonly events: ExamVersionJobEventsService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job<ExamVersionJobData>): Promise<void> {
    const record = await this.repository.getByIdUnscoped(job.data.jobId);
    if (!record || TERMINAL_STATUSES.includes(record.status)) {
      return;
    }

    // Zeroes `completed_count` as well as flipping the status — see
    // `startAttempt()`'s docstring: unlike the AI worker, this one is not
    // resumable, every attempt regenerates all forms from scratch.
    await this.repository.startAttempt(record.id);
    this.events.notify(record.id);

    // The worker has no HTTP request context; the row carries everything
    // needed to reconstruct the caller's identity (same pattern as
    // `GenerationJobsProcessor`).
    const user: AuthTokenPayload = {
      sub: record.createdBy,
      tenantId: record.tenantId,
      role: record.createdByRole as Role,
    };

    try {
      await this.generationService.generateVersions(user, record.examId, record.versionCount, async () => {
        await this.repository.incrementCompleted(record.id);
        this.events.notify(record.id);
      });
    } catch (error) {
      if (error instanceof ExamPdfGenerationError) {
        // A content fault (a question Typst cannot compile), not a blip:
        // retrying feeds the compiler the same input and fails identically,
        // so resolve terminally now instead of burning the backoff budget.
        // The forms generated before the failure stay persisted and
        // downloadable — `markFailed` never touches `completed_count`.
        this.logger.error(
          { jobId: record.id, examId: record.examId, questionId: error.questionId, err: error.message },
          "Exam version generation failed on a question",
        );
        await this.repository.markFailed(record.id, {
          reason: error.message,
          questionId: error.questionId,
        });
        this.events.notify(record.id);
        return;
      }
      // Anything else (storage/DB/subprocess blip) IS worth retrying — let
      // BullMQ do it; `onFailed` resolves the row if the retries run out.
      throw error;
    }

    await this.repository.setStatus(record.id, "completed");
    this.events.notify(record.id);
  }

  /**
   * BullMQ emits `failed` once per attempt, including intermediate retries.
   * Only the FINAL exhausted failure resolves the row to `failed` — same
   * reasoning (and same `job` can-be-undefined caveat) as
   * `GenerationJobsProcessor.onFailed`.
   */
  @OnWorkerEvent("failed")
  async onFailed(job: Job<ExamVersionJobData> | undefined): Promise<void> {
    if (!job) {
      return;
    }

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      return;
    }

    this.logger.error(
      { jobId: job.data.jobId, bullJobId: job.id, attemptsMade: job.attemptsMade, err: job.failedReason },
      "Exam version job exhausted retries",
    );

    const record = await this.repository.getByIdUnscoped(job.data.jobId);
    if (!record || TERMINAL_STATUSES.includes(record.status)) {
      return;
    }

    await this.repository.markFailed(record.id, {
      reason: job.failedReason ?? "La generación falló tras varios intentos",
    });
    this.events.notify(record.id);
  }
}
