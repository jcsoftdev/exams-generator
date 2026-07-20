import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from "@nestjs/common";
import { clampPagination } from "../../common/pagination.util";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { CreateGenerationJobDto, GenerationJobsService } from "./generation-jobs.service";

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
  constructor(private readonly service: GenerationJobsService) {}

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

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentUser() user: AuthTokenPayload, @Param("id") id: string) {
    return this.service.cancel(user, id);
  }
}
