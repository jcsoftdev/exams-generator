import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { filter } from "rxjs";
import { clampPagination } from "../../common/pagination.util";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { GenerationJobEventsService } from "./generation-job-events.service";
import { CreateGenerationJobDto, GenerationJobsService } from "./generation-jobs.service";

const TERMINAL_STATUSES: readonly string[] = ["completed", "failed", "cancelled"];

/**
 * `/ai/questions/jobs` — durable AI-generation batch jobs (design doc:
 * docs/superpowers/specs/2026-07-19-ai-generation-history-design.md §4).
 * `POST /` responds 202 (Accepted), not 201 — the job is queued, not yet
 * done. Same guard as `AiController` (any authenticated tenant user, no
 * role restriction).
 */
@Controller("ai/questions/jobs")
@UseGuards(JwtAuthGuard)
export class AiJobsController {
  constructor(
    private readonly service: GenerationJobsService,
    private readonly events: GenerationJobEventsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(@CurrentUser() user: AuthTokenPayload, @Body() body: CreateGenerationJobDto) {
    return this.service.create(user, body);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthTokenPayload,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    const { page: p, pageSize: ps } = clampPagination(page, pageSize);
    return this.service.list(user, p, ps);
  }

  @Get(":id")
  async get(@CurrentUser() user: AuthTokenPayload, @Param("id") id: string) {
    return this.service.get(user, id);
  }

  /** `GET /ai/questions/jobs/:id/chain` — every attempt in `id`'s retry chain, oldest first. */
  @Get(":id/chain")
  async chain(@CurrentUser() user: AuthTokenPayload, @Param("id") id: string) {
    return { items: await this.service.getChain(user, id) };
  }

  /**
   * `GET /ai/questions/jobs/:id/stream` — push counterpart of `GET :id`.
   * Same hand-rolled SSE + client-side HttpClient-text-stream workaround as
   * `AiController.generateStream()` (a native browser `EventSource` can't
   * send the `Authorization` header `JwtAuthGuard` requires). Writes the
   * current job immediately, then again every time
   * `GenerationJobEventsService` reports a write for this id — driven by
   * `GenerationJobsProcessor` calling `notify()` right after each DB
   * commit, never by polling on either side — until the job reaches a
   * terminal status, at which point the connection closes.
   */
  @Get(":id/stream")
  async stream(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const writeJob = (job: unknown): void => {
      res.write(`data: ${JSON.stringify(job)}\n\n`);
    };

    const current = await this.service.get(user, id);
    writeJob(current);
    if (TERMINAL_STATUSES.includes(current.status)) {
      res.end();
      return;
    }

    const subscription = this.events.updates$.pipe(filter((jobId) => jobId === id)).subscribe(async () => {
      const job = await this.service.get(user, id);
      writeJob(job);
      if (TERMINAL_STATUSES.includes(job.status)) {
        res.end();
      }
    });

    res.on("close", () => subscription.unsubscribe());
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentUser() user: AuthTokenPayload, @Param("id") id: string) {
    return this.service.cancel(user, id);
  }
}
