import { Role } from "@exams-generator/shared";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AuthTokenPayload } from "../auth/token.service";
import {
  ExamPdfGenerationError,
  ExamVersionGenerationService,
  GeneratedVersionResult,
} from "./exam-generation.service";
import {
  ConfirmExamResult,
  CreateExamDto,
  CreateExamResult,
  ExamDetailResult,
  ExamsService,
  ExamVersionSummary,
  InsufficientQuestionStockError,
  PreviewExamDto,
  PreviewExamResult,
  ReplaceQuestionDto,
  ReplaceQuestionResult,
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
  }>;
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
  ) {}

  @Post()
  async create(@CurrentUser() user: AuthTokenPayload, @Body() body: CreateExamBody): Promise<CreateExamResult> {
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

  /** `POST /exams/preview` (B2) — same body shape as `POST /exams` minus `title`; pure read, no persistence (200 not 201). */
  @Post("preview")
  @HttpCode(HttpStatus.OK)
  async preview(@CurrentUser() user: AuthTokenPayload, @Body() body: CreateExamBody): Promise<PreviewExamResult> {
    return this.examsService.previewExam(user, body as PreviewExamDto);
  }

  @Get(":examId")
  async getExam(@CurrentUser() user: AuthTokenPayload, @Param("examId") examId: string): Promise<ExamDetailResult> {
    return this.examsService.getExamDetail(user, examId);
  }

  @Post(":examId/questions/:questionId/replace")
  async replaceQuestion(
    @CurrentUser() user: AuthTokenPayload,
    @Param("examId") examId: string,
    @Param("questionId") questionId: string,
    @Body() body: ReplaceQuestionBody,
  ): Promise<ReplaceQuestionResult> {
    const dto: ReplaceQuestionDto =
      body.mode === "manual"
        ? { mode: "manual", replacementQuestionId: body.replacementQuestionId ?? "" }
        : { mode: "reroll" };

    return this.examsService.replaceQuestion(user, examId, questionId, dto);
  }

  @Post(":examId/confirm")
  async confirm(@CurrentUser() user: AuthTokenPayload, @Param("examId") examId: string): Promise<ConfirmExamResult> {
    return this.examsService.confirmExam(user, examId);
  }

  /** `GET /exams/:examId/versions` (B4) — read-only history, distinct from `POST /versions` (generate). */
  @Get(":examId/versions")
  async getVersions(
    @CurrentUser() user: AuthTokenPayload,
    @Param("examId") examId: string,
  ): Promise<readonly ExamVersionSummary[]> {
    return this.examsService.listVersions(user, examId);
  }

  @Post(":examId/versions")
  async generateVersions(
    @CurrentUser() user: AuthTokenPayload,
    @Param("examId") examId: string,
    @Body() body: GenerateVersionsBody,
  ): Promise<GeneratedVersionResult[]> {
    try {
      return await this.generationService.generateVersions(user, examId, body.versionCount ?? 1);
    } catch (error) {
      if (error instanceof ExamPdfGenerationError) {
        throw new UnprocessableEntityException({
          message: error.message,
          examId: error.examId,
          questionId: error.questionId,
        });
      }
      throw error;
    }
  }
}
