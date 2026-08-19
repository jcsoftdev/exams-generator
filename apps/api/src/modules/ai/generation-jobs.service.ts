import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Difficulty } from "@exams-generator/shared";
import { Queue } from "bullmq";
import { AuthTokenPayload } from "../auth/token.service";
import { BankRepository } from "../bank/bank.repository";
import { GenerateQuestionsInput, validateGenerateQuestionsInput } from "./domain/validate-generate-questions-input";
import { GenerationJobData } from "./generation-jobs.processor";
import { GenerationJobListRecord, GenerationJobRecord, GenerationJobsRepository } from "./generation-jobs.repository";

export interface CreateGenerationJobDto {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: string;
  readonly gradeLevel?: string;
  readonly count?: number;
  readonly withFigure?: boolean;
  /** Set by `GenerationJobDetailComponent.retry()` — the job this one resubmits. */
  readonly retriedFromJobId?: string;
}

/**
 * `/ai/questions/jobs` use cases (design doc §4). `create()` validates
 * synchronously — same checks `GenerateQuestionsService.generateQuestions()`
 * already runs — BEFORE ever touching the queue, so bad input still gets an
 * immediate 400/404 and nothing is enqueued.
 */
/**
 * Ceiling on a tenant's simultaneously in-flight (`pending`/`running`)
 * generation jobs. Each job is up to `MAX_COUNT` (10) OpenRouter calls, and the
 * only other brake is the global 100 req/min IP throttle plus the worker's
 * `concurrency: 2` — both cap the SPEND RATE, neither caps the TOTAL. Without
 * this, one authenticated account can enqueue thousands of jobs and they all
 * bill (audit 2026-08-18). 20 is generous for a real teacher (a full exam's
 * worth of generation in parallel) and a hard wall against a runaway.
 */
export const MAX_ACTIVE_JOBS_PER_TENANT = 20;

@Injectable()
export class GenerationJobsService {
  constructor(
    private readonly repository: GenerationJobsRepository,
    private readonly bankRepository: BankRepository,
    @InjectQueue("generation") private readonly queue: Queue<GenerationJobData>,
  ) {}

  async create(user: AuthTokenPayload, dto: CreateGenerationJobDto): Promise<GenerationJobRecord> {
    const tenantId = this.requireTenant(user);

    const validation = validateGenerateQuestionsInput(dto as GenerateQuestionsInput);
    if (!validation.ok) {
      throw new BadRequestException(validation.errors);
    }

    const active = await this.repository.countActiveByTenant(tenantId);
    if (active >= MAX_ACTIVE_JOBS_PER_TENANT) {
      throw new HttpException(
        `This school already has ${active} question-generation jobs running. Wait for some to finish before starting more.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const taxonomy = await this.bankRepository.findCourseAndTopicNames(
      dto.courseId as string,
      dto.topicId as string,
    );
    if (!taxonomy) {
      throw new NotFoundException("courseId/topicId not found, or topicId does not belong to courseId");
    }

    let retryLink: { retriedFromJobId: string; rootJobId: string } | undefined;
    if (dto.retriedFromJobId) {
      const parent = await this.repository.getById(dto.retriedFromJobId, tenantId);
      if (!parent) {
        throw new NotFoundException(`Generation job not found: ${dto.retriedFromJobId}`);
      }
      // `rootJobId` always points at the chain's ORIGINAL job, never at
      // `parent` itself — a retry-of-a-retry must still land in the same
      // chain as the very first attempt, not start a new two-link chain.
      retryLink = { retriedFromJobId: parent.id, rootJobId: parent.rootJobId ?? parent.id };
    }

    const record = await this.repository.create({
      tenantId,
      createdBy: user.sub,
      createdByRole: user.role,
      courseId: dto.courseId as string,
      topicId: dto.topicId as string,
      difficulty: dto.difficulty as Difficulty,
      gradeLevel: dto.gradeLevel as string,
      count: dto.count as number,
      withFigure: dto.withFigure ?? false,
      ...retryLink,
    });

    try {
      await this.queue.add("generate", { jobId: record.id }, { jobId: record.id });
    } catch (error) {
      // The row is already persisted as "pending" — if it never reaches
      // Redis, nothing will ever process it. Mark it "failed" so the row
      // stays truthful (durable record of "we tried, enqueueing failed")
      // instead of being stranded at "pending" forever, then re-throw so
      // the caller still sees the original error.
      await this.repository.setStatus(record.id, "failed");
      throw error;
    }

    return record;
  }

  async get(user: AuthTokenPayload, jobId: string): Promise<GenerationJobRecord> {
    const tenantId = this.requireTenant(user);
    const record = await this.repository.getById(jobId, tenantId);
    if (!record) {
      throw new NotFoundException(`Generation job not found: ${jobId}`);
    }
    return record;
  }

  async list(
    user: AuthTokenPayload,
    page: number,
    pageSize: number,
  ): Promise<{ items: GenerationJobListRecord[]; total: number }> {
    const tenantId = this.requireTenant(user);
    return this.repository.list(tenantId, page, pageSize);
  }

  /** Full "historial de reintentos" for `jobId` — every attempt in its chain, oldest first, whether `jobId` is the original job or a later retry. */
  async getChain(user: AuthTokenPayload, jobId: string): Promise<GenerationJobRecord[]> {
    const tenantId = this.requireTenant(user);
    const record = await this.repository.getById(jobId, tenantId);
    if (!record) {
      throw new NotFoundException(`Generation job not found: ${jobId}`);
    }
    return this.repository.listChain(tenantId, record.rootJobId ?? record.id);
  }

  /** Idempotent: cancelling an already-terminal job succeeds without error, matching `GenerationJobsRepository.requestCancel()`'s no-op semantics. */
  async cancel(user: AuthTokenPayload, jobId: string): Promise<GenerationJobRecord> {
    const tenantId = this.requireTenant(user);
    const record = await this.repository.getById(jobId, tenantId);
    if (!record) {
      throw new NotFoundException(`Generation job not found: ${jobId}`);
    }
    if (record.status === "pending" || record.status === "running") {
      await this.repository.requestCancel(jobId);
      return (await this.repository.getById(jobId, tenantId))!;
    }
    return record;
  }

  private requireTenant(user: AuthTokenPayload): string {
    if (!user.tenantId) {
      throw new BadRequestException("Only tenant users can access generation jobs");
    }
    return user.tenantId;
  }
}
