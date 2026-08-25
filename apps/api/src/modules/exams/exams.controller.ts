import { Role } from "@exams-generator/shared";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UnprocessableEntityException,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { filter } from "rxjs";
import { clampPagination } from "../../common/pagination.util";
import { GenerationJobStatus } from "../../db/schema/enums";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { ExamVersionGenerationService } from "./exam-generation.service";
import { ExamVersionJobEventsService } from "./exam-version-job-events.service";
import { ExamVersionJobRecord } from "./exam-version-jobs.repository";
import { ExamVersionJobsService } from "./exam-version-jobs.service";
import {
  ConfirmExamResult,
  CreateExamDto,
  CreateExamResult,
  DuplicateExamResult,
  ExamDetailResult,
  ExamsService,
  ExamVersionSummary,
  InsufficientQuestionStockError,
  PreviewExamDto,
  PreviewExamResult,
  ReplaceQuestionDto,
  ReplaceQuestionResult,
  ResolveExamBlueprintResult,
  GradeLevelStockResult,
  StockBatchDto,
  StockBatchResult,
} from "./exams.service";

interface CreateExamBody {
  readonly title?: string;
  readonly gradeLevel?: string;
  readonly blueprint?: ReadonlyArray<{
    readonly courseId?: string;
    readonly topicId?: string;
    readonly difficulty?: string;
    readonly count?: number;
    /**
     * Layout metadata `POST /exams/blueprint/resolve` already worked out. The
     * builder sends it straight back: without it everything the template
     * resolved is lost on the round trip and the exam prints with no sections
     * (design doc §4). Absent in a manual blueprint.
     */
    readonly sortOrder?: number;
    readonly blockCode?: string;
    readonly blockLabel?: string;
    readonly sectionCode?: string;
    readonly sectionLabel?: string;
  }>;
  readonly examType?: string;
  readonly universityId?: string;
  readonly trackId?: string;
  readonly cycleId?: string;
  readonly weekNumber?: number;
}

interface ResolveExamBlueprintBody {
  readonly examTypeCode?: string;
  readonly universityId?: string;
  readonly trackId?: string;
  readonly selectedCourseIds?: readonly string[];
  readonly totalQuestionsOverride?: number;
}

interface RenameExamBody {
  readonly title?: string;
}

interface ReplaceQuestionBody {
  readonly mode?: "reroll" | "manual";
  readonly replacementQuestionId?: string;
}

interface GenerateVersionsBody {
  readonly versionCount?: number;
}

interface StockBatchBody {
  readonly gradeLevel?: string;
  readonly cells?: ReadonlyArray<{
    readonly courseId?: string;
    readonly topicId?: string;
    readonly difficulty?: string;
  }>;
}

const TERMINAL_JOB_STATUSES: readonly GenerationJobStatus[] = ["completed", "failed", "cancelled"];

/**
 * `/exams` — the exams module's HTTP surface (design doc §5.3, §5.4).
 * `TenantGuard` is intentionally NOT applied here: unlike `/tenants/:id`,
 * exam ownership is never taken from a route param — every operation is
 * scoped to `user.tenantId` inside `ExamsService`/`ExamVersionGenerationService`
 * (same reasoning as `BankController`, which scopes via the service layer
 * too).
 */
@Controller("exams")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Teacher, Role.SchoolAdmin)
export class ExamsController {
  constructor(
    private readonly examsService: ExamsService,
    private readonly generationService: ExamVersionGenerationService,
    private readonly versionJobsService: ExamVersionJobsService,
    private readonly versionJobEvents: ExamVersionJobEventsService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: CreateExamBody,
  ): Promise<CreateExamResult> {
    try {
      return await this.examsService.createExam(user, body as CreateExamDto);
    } catch (error) {
      if (error instanceof InsufficientQuestionStockError) {
        throw new UnprocessableEntityException({
          message: error.message,
          examId: error.examId,
          shortages: error.shortages,
        });
      }
      throw error;
    }
  }

  /** `POST /exams/stock/batch` (B1) — sibling method, inherits class-level guards, pure read (no persistence, hence 200 not 201). */
  @Post("stock/batch")
  @HttpCode(HttpStatus.OK)
  async countStock(
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: StockBatchBody,
  ): Promise<StockBatchResult> {
    return this.examsService.countStock(user, body as StockBatchDto);
  }

  /**
   * `GET /exams/stock/grades` — approved-question count per grade level, so
   * the builder can flag the grades that have no bank BEFORE the teacher picks
   * one (audit 2026-08-15: 11 of the 12 catalog grades dead-ended). Declared
   * above `@Get(":examId")` for the same reason `@Get()` is — otherwise the
   * param route swallows the literal path.
   */
  @Get("stock/grades")
  async countStockByGradeLevel(@CurrentUser() user: AuthTokenPayload): Promise<GradeLevelStockResult> {
    return this.examsService.countStockByGradeLevel(user);
  }

  /** `POST /exams/preview` (B2) — same body shape as `POST /exams` minus `title`; pure read, no persistence (200 not 201). */
  @Post("preview")
  @HttpCode(HttpStatus.OK)
  async preview(
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: CreateExamBody,
  ): Promise<PreviewExamResult> {
    return this.examsService.previewExam(user, body as PreviewExamDto);
  }

  /**
   * `POST /exams/blueprint/resolve` (design doc §3.11) — ADDITIVE: lets the
   * frontend pre-fill the existing manual blueprint builder for a
   * template-backed exam type (`fastest`/`eta`/`eta_by_week`). Pure read, no
   * persistence (200 not 201) — same convention as `preview`/`countStock`.
   * The result feeds straight back into `POST /exams`'s body as if the user
   * had typed it by hand; this endpoint never creates or mutates an exam,
   * and does NOT replace or change `POST /exams`'/`POST /exams/preview`'s
   * contract.
   */
  @Post("blueprint/resolve")
  @HttpCode(HttpStatus.OK)
  async resolveBlueprint(
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: ResolveExamBlueprintBody,
  ): Promise<ResolveExamBlueprintResult> {
    if (!body.examTypeCode || !body.universityId) {
      throw new BadRequestException("examTypeCode and universityId are required");
    }
    return this.examsService.resolveExamBlueprint({
      examTypeCode: body.examTypeCode,
      universityId: body.universityId,
      trackId: body.trackId ?? null,
      tenantId: user.tenantId,
      selectedCourseIds: body.selectedCourseIds,
      totalQuestionsOverride: body.totalQuestionsOverride,
    });
  }

  /**
   * `GET /exams` (S1) — tenant-scoped, filtered, paginated list (plan 2's
   * web list screen). Declared BEFORE `@Get(":examId")` so Nest's route
   * matching tries the literal `/exams` path first — otherwise `:examId`
   * would greedily capture this route.
   */
  @Get()
  async listExams(
    @CurrentUser() user: AuthTokenPayload,
    @Query("status") status?: "draft" | "ready",
    @Query("gradeLevel") gradeLevel?: string,
    @Query("search") search?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    if (status !== undefined && !["draft", "ready"].includes(status)) {
      throw new BadRequestException("status must be draft or ready");
    }
    return this.examsService.listExams(user, {
      status,
      gradeLevel,
      search,
      ...clampPagination(page, pageSize),
    });
  }

  /**
   * `PATCH /exams/:examId` (S4) — rename. The only mutable field: everything
   * else about an exam is either derived or immutable once selected.
   */
  @Patch(":examId")
  async renameExam(
    @CurrentUser() user: AuthTokenPayload,
    @Param("examId", ParseUUIDPipe) examId: string,
    @Body() body: RenameExamBody,
  ): Promise<{ id: string; title: string }> {
    return this.examsService.renameExam(user, examId, body.title ?? "");
  }

  @Get(":examId")
  async getExam(
    @CurrentUser() user: AuthTokenPayload,
    @Param("examId", ParseUUIDPipe) examId: string,
  ): Promise<ExamDetailResult> {
    return this.examsService.getExamDetail(user, examId);
  }

  /** `DELETE /exams/:examId` (S3) — cascading delete; no status restriction (confirmation is the frontend's job). */
  @Delete(":examId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthTokenPayload,
    @Param("examId", ParseUUIDPipe) examId: string,
  ): Promise<void> {
    await this.examsService.deleteExam(user, examId);
  }

  @Post(":examId/questions/:questionId/replace")
  async replaceQuestion(
    @CurrentUser() user: AuthTokenPayload,
    @Param("examId", ParseUUIDPipe) examId: string,
    @Param("questionId", ParseUUIDPipe) questionId: string,
    @Body() body: ReplaceQuestionBody,
  ): Promise<ReplaceQuestionResult> {
    const dto: ReplaceQuestionDto =
      body.mode === "manual"
        ? { mode: "manual", replacementQuestionId: body.replacementQuestionId ?? "" }
        : { mode: "reroll" };

    return this.examsService.replaceQuestion(user, examId, questionId, dto);
  }

  @Post(":examId/confirm")
  async confirm(
    @CurrentUser() user: AuthTokenPayload,
    @Param("examId", ParseUUIDPipe) examId: string,
  ): Promise<ConfirmExamResult> {
    return this.examsService.confirmExam(user, examId);
  }

  /** `POST /exams/:examId/duplicate` (S2) — "usar de plantilla": clones title/blueprint/selection into a new `draft` exam. */
  @Post(":examId/duplicate")
  async duplicate(
    @CurrentUser() user: AuthTokenPayload,
    @Param("examId", ParseUUIDPipe) examId: string,
  ): Promise<DuplicateExamResult> {
    return this.examsService.duplicateExam(user, examId);
  }

  /**
   * `GET /exams/:examId/versions/zip` (N1) — bundles every generated form +
   * answer sheet into one ZIP download. Declared BEFORE `:examId/versions`
   * so Nest matches this literal-suffixed route first (both live under the
   * same `:examId` prefix). `@Res()` is used to set the binary
   * `Content-Type`/`Content-Disposition` headers directly.
   */
  @Get(":examId/versions/zip")
  async downloadVersionsZip(
    @CurrentUser() user: AuthTokenPayload,
    @Param("examId", ParseUUIDPipe) examId: string,
    @Res() res: Response,
  ): Promise<void> {
    const zip = await this.generationService.buildVersionsZip(user, examId);
    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", `attachment; filename="examen-${examId}-versiones.zip"`);
    res.send(zip);
  }

  /** `GET /exams/:examId/versions` (B4) — read-only history, distinct from `POST /versions` (generate). */
  @Get(":examId/versions")
  async getVersions(
    @CurrentUser() user: AuthTokenPayload,
    @Param("examId", ParseUUIDPipe) examId: string,
  ): Promise<readonly ExamVersionSummary[]> {
    return this.examsService.listVersions(user, examId);
  }

  /**
   * `POST /exams/:examId/versions` — ENQUEUES generation and responds 202
   * (Accepted) with the job row; it no longer compiles PDFs inline (audit
   * P0). Every precondition is still checked synchronously before enqueuing,
   * so bad input keeps returning the same 400/404/409 it always did — only
   * the success path changed shape, from `GeneratedVersionResult[]` to a job
   * the caller follows via `jobs/:jobId/stream`.
   */
  @Post(":examId/versions")
  @HttpCode(HttpStatus.ACCEPTED)
  async generateVersions(
    @CurrentUser() user: AuthTokenPayload,
    @Param("examId", ParseUUIDPipe) examId: string,
    @Body() body: GenerateVersionsBody,
  ): Promise<ExamVersionJobRecord> {
    return this.versionJobsService.create(user, examId, body.versionCount ?? 1);
  }

  /**
   * `GET /exams/:examId/versions/jobs/latest` — the exam's most recent job,
   * or `null` if it has never been generated. Declared BEFORE `:jobId` so
   * Nest matches this literal segment first. Lets a reloaded versions screen
   * re-attach to a generation that is still running (the job id from the
   * original `POST` response is long gone by then).
   */
  @Get(":examId/versions/jobs/latest")
  async latestVersionJob(
    @CurrentUser() user: AuthTokenPayload,
    @Param("examId", ParseUUIDPipe) examId: string,
  ): Promise<ExamVersionJobRecord | null> {
    return this.versionJobsService.getLatestForExam(user, examId);
  }

  @Get(":examId/versions/jobs/:jobId")
  async getVersionJob(
    @CurrentUser() user: AuthTokenPayload,
    @Param("jobId", ParseUUIDPipe) jobId: string,
  ): Promise<ExamVersionJobRecord> {
    return this.versionJobsService.get(user, jobId);
  }

  /**
   * `GET /exams/:examId/versions/jobs/:jobId/stream` — push counterpart of
   * the endpoint above, byte-identical wire format to
   * `AiJobsController.stream()` (hand-rolled `data: {...}\n\n` frames rather
   * than a native `EventSource`, which cannot carry the `Authorization`
   * header `JwtAuthGuard` requires). Writes the current job immediately,
   * then again on every `ExamVersionJobEventsService` notification for this
   * id — i.e. once per generated form — until the job is terminal, at which
   * point the connection closes.
   *
   * ORDERING IS LOAD-BEARING — do NOT move the header block back above the
   * lookup. `@Res()` takes this handler outside Nest's response handling, so
   * `flushHeaders()` puts a `200 OK` on the wire irrevocably. When the
   * tenant-scoped lookup ran after it, an unknown or cross-tenant jobId lied
   * with a 200 and then threw `NotFoundException` into
   * `AllExceptionsFilter`, which crashed the whole process trying to write a
   * 404 body onto a started response (`ERR_HTTP_HEADERS_SENT`, unhandled).
   * Fetching the job FIRST keeps the not-found on Nest's normal path, so the
   * caller gets a real 404.
   */
  @Get(":examId/versions/jobs/:jobId/stream")
  async streamVersionJob(
    @CurrentUser() user: AuthTokenPayload,
    @Param("jobId", ParseUUIDPipe) jobId: string,
    @Res() res: Response,
  ): Promise<void> {
    const current = await this.versionJobsService.get(user, jobId);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const writeJob = (job: ExamVersionJobRecord): void => {
      res.write(`data: ${JSON.stringify(job)}\n\n`);
    };

    writeJob(current);
    if (TERMINAL_JOB_STATUSES.includes(current.status)) {
      res.end();
      return;
    }

    // The handler is deliberately a void-returning wrapper around the async
    // work: `subscribe` expects `void`, and returning the promise would make
    // rejections unobservable.
    const subscription = this.versionJobEvents.updates$.pipe(filter((id) => id === jobId)).subscribe(() => {
      void (async () => {
        const job = await this.versionJobsService.get(user, jobId);
        writeJob(job);
        if (TERMINAL_JOB_STATUSES.includes(job.status)) {
          res.end();
        }
      })();
    });

    res.on("close", () => subscription.unsubscribe());
  }
}
