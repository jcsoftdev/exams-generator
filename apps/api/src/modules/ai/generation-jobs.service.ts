import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Difficulty } from "@exams-generator/shared";
import { Queue } from "bullmq";
import { AuthTokenPayload } from "../auth/token.service";
import { BankRepository } from "../bank/bank.repository";
import { GenerateQuestionsInput, validateGenerateQuestionsInput } from "./domain/validate-generate-questions-input";
import { GenerationJobData } from "./generation-jobs.processor";
import { GenerationJobRecord, GenerationJobsRepository } from "./generation-jobs.repository";

export interface CreateGenerationJobDto {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: string;
  readonly gradeLevel?: string;
  readonly count?: number;
  readonly withFigure?: boolean;
}

/**
 * `/ai/questions/jobs` use cases (design doc §4). `create()` validates
 * synchronously — same checks `GenerateQuestionsService.generateQuestions()`
 * already runs — BEFORE ever touching the queue, so bad input still gets an
 * immediate 400/404 and nothing is enqueued.
 */
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

    const taxonomy = await this.bankRepository.findCourseAndTopicNames(
      dto.courseId as string,
      dto.topicId as string,
    );
    if (!taxonomy) {
      throw new NotFoundException("courseId/topicId not found, or topicId does not belong to courseId");
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
    });

    await this.queue.add("generate", { jobId: record.id }, { jobId: record.id });

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
  ): Promise<{ items: GenerationJobRecord[]; total: number }> {
    const tenantId = this.requireTenant(user);
    return this.repository.list(tenantId, page, pageSize);
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
