import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { AuthTokenPayload } from "../auth/token.service";
import { ExamVersionGenerationService } from "./exam-generation.service";
import { ExamVersionJobRecord, ExamVersionJobsRepository } from "./exam-version-jobs.repository";
import { ExamVersionJobData } from "./exam-version-jobs.processor";

/**
 * `POST /exams/:examId/versions` use cases, now queue-backed (audit P0 —
 * PDF compilation used to run inside the request/response cycle).
 *
 * `create()` runs `ExamVersionGenerationService.prepareGeneration()`
 * synchronously BEFORE touching the queue, so every rejection the endpoint
 * used to return still comes back immediately and with the same status: 400
 * (bad `versionCount`, platform staff), 404 (unknown/cross-tenant exam), 409
 * (unconfirmed exam, empty selection). Only the expensive half moves to the
 * worker.
 */
@Injectable()
export class ExamVersionJobsService {
  constructor(
    private readonly repository: ExamVersionJobsRepository,
    private readonly generationService: ExamVersionGenerationService,
    @InjectQueue("exam-versions") private readonly queue: Queue<ExamVersionJobData>,
  ) {}

  async create(user: AuthTokenPayload, examId: string, versionCount: number): Promise<ExamVersionJobRecord> {
    await this.generationService.prepareGeneration(user, examId, versionCount);

    const record = await this.repository.create({
      // `prepareGeneration` already rejected a null tenant, so this is safe.
      tenantId: user.tenantId as string,
      examId,
      createdBy: user.sub,
      createdByRole: user.role,
      versionCount,
    });

    try {
      await this.queue.add("generate-versions", { jobId: record.id }, { jobId: record.id });
    } catch (error) {
      // The row is already persisted as "pending" — if it never reaches
      // Redis, nothing will ever process it. Mark it "failed" so the row
      // stays truthful instead of being stranded at "pending" forever, then
      // re-throw so the caller still sees the original error.
      await this.repository.setStatus(record.id, "failed");
      throw error;
    }

    return record;
  }

  async get(user: AuthTokenPayload, jobId: string): Promise<ExamVersionJobRecord> {
    const tenantId = this.requireTenant(user);
    const record = await this.repository.getById(jobId, tenantId);
    if (!record) {
      throw new NotFoundException(`Exam version job not found: ${jobId}`);
    }
    return record;
  }

  /**
   * Newest job for an exam, or `null` when it has never been generated — an
   * exam with no generation history is a valid state (same reasoning as
   * `listVersions` returning `[]` rather than 404), so the versions screen
   * can ask unconditionally on load to re-attach to an in-flight run.
   */
  async getLatestForExam(user: AuthTokenPayload, examId: string): Promise<ExamVersionJobRecord | null> {
    const tenantId = this.requireTenant(user);
    return (await this.repository.getLatestForExam(examId, tenantId)) ?? null;
  }

  private requireTenant(user: AuthTokenPayload): string {
    if (!user.tenantId) {
      throw new BadRequestException("Only tenant users can access exam version jobs");
    }
    return user.tenantId;
  }
}
