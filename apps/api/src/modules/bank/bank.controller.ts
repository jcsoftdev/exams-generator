import { Difficulty } from "@exams-generator/shared";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { QuestionStatus } from "../../db/schema/enums";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { BankService } from "./bank.service";
import { QuestionListItem } from "./bank.repository";
import { clampPagination } from "./pagination.util";

interface CreateImageQuestionBody {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: string;
  readonly gradeLevel?: string;
  readonly correctAnswer?: string;
}

interface CreateStructuredQuestionBody {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: string;
  readonly gradeLevel?: string;
  readonly bodyTypst?: string;
  readonly alternatives?: readonly string[];
  readonly correctAnswer?: string;
  readonly figureCode?: string;
}

interface EditDraftQuestionBody {
  readonly bodyTypst?: string;
  readonly alternatives?: readonly string[];
  readonly correctAnswer?: string;
  readonly figureCode?: string;
}

interface ListQuestionsQueryParams {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: string;
  readonly gradeLevel?: string;
  readonly status?: string;
  /**
   * S6: optional pagination. `page === undefined` is the retro-compat
   * signal — the controller returns the legacy flat array in that case,
   * NEVER the `{items,total}` envelope (existing web consumers decode a
   * bare array).
   */
  readonly page?: string;
  readonly pageSize?: string;
}

/**
 * `POST /bank/questions/image`, `POST /bank/questions/structured` and
 * `GET /bank/questions` — manual bank curation endpoints (both creation
 * routes persist directly to `status = 'approved'`, curated by definition,
 * design doc §5.1). Also the human side of the AI draft workflow (Lane D3,
 * design doc §5.2): `POST :id/approve`, `POST :id/reject`, `PATCH :id` — the
 * AI-generation endpoint itself (`POST /ai/questions/generate`, which
 * CREATES the drafts this reviews) lives in the `ai` module.
 */
@Controller("bank/questions")
@UseGuards(JwtAuthGuard)
export class BankController {
  constructor(private readonly service: BankService) {}

  @Post("image")
  @UseInterceptors(FileInterceptor("image"))
  async createImageQuestion(
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: CreateImageQuestionBody,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ id: string }> {
    return this.service.createImageQuestion(user, {
      courseId: body.courseId,
      topicId: body.topicId,
      difficulty: body.difficulty,
      gradeLevel: body.gradeLevel,
      correctAnswer: body.correctAnswer,
      file,
    });
  }

  @Post("structured")
  async createStructuredQuestion(
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: CreateStructuredQuestionBody,
  ): Promise<{ id: string }> {
    return this.service.createStructuredQuestion(user, {
      courseId: body.courseId,
      topicId: body.topicId,
      difficulty: body.difficulty,
      gradeLevel: body.gradeLevel,
      bodyTypst: body.bodyTypst,
      alternatives: body.alternatives,
      correctAnswer: body.correctAnswer,
      figureCode: body.figureCode,
    });
  }

  /**
   * S6: optional pagination, retro-compat. `page === undefined` returns the
   * SAME flat array this endpoint always returned — web's `bank.service.ts`
   * and `ai.service.ts`'s `listDrafts` both still decode a bare array.
   * `?page=&pageSize=` switches to `{ items, total }`, clamped the same way
   * `ExamsController.listExams` (T2) clamps its own page/pageSize.
   */
  @Get()
  async listQuestions(
    @CurrentUser() user: AuthTokenPayload,
    @Query() query: ListQuestionsQueryParams,
  ): Promise<QuestionListItem[] | { items: QuestionListItem[]; total: number }> {
    const filters = {
      courseId: query.courseId,
      topicId: query.topicId,
      difficulty: query.difficulty as Difficulty | undefined,
      gradeLevel: query.gradeLevel,
      status: query.status as QuestionStatus | undefined,
    };

    if (query.page === undefined) {
      return this.service.listQuestions(user, filters);
    }

    return this.service.listQuestions(user, filters, clampPagination(query.page, query.pageSize));
  }

  /**
   * S7: single-question Typst PDF preview, in-memory cached (invalidated by
   * `PATCH :id`). Declared BEFORE `@Get(":id")` — a static-looking suffix
   * route must be registered before the generic `:id` catch-all in the same
   * file for Nest's route matching to prefer it.
   */
  @Get(":id/preview")
  async preview(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.service.previewQuestion(user, id);
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  }

  /**
   * Direct-by-id fetch (release gate: id enumeration guard, design doc §3).
   * `id` is a route param (the question id), NEVER a tenant id — tenant
   * scoping always comes from `@CurrentUser()` (the verified JWT claim via
   * `JwtAuthGuard`), never from anything client-supplied.
   */
  @Get(":id")
  async getQuestionById(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id") id: string,
  ): Promise<QuestionListItem> {
    return this.service.getQuestionById(user, id);
  }

  /** Lane D3: human curation — draft -> approved. */
  @Post(":id/approve")
  async approveQuestion(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id") id: string,
  ): Promise<{ id: string }> {
    return this.service.approveQuestion(user, id);
  }

  /** Lane D3: human curation — rejects (deletes) a draft. */
  @Post(":id/reject")
  async rejectQuestion(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id") id: string,
  ): Promise<{ id: string }> {
    return this.service.rejectQuestion(user, id);
  }

  /**
   * Lane D3: human edit of a draft's structured content before approval.
   * Recompiles the Typst preview server-side; a broken edit is rejected
   * with 400 and never persisted.
   */
  @Patch(":id")
  async editDraftQuestion(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id") id: string,
    @Body() body: EditDraftQuestionBody,
  ): Promise<QuestionListItem> {
    return this.service.editDraftQuestion(user, id, {
      bodyTypst: body.bodyTypst,
      alternatives: body.alternatives,
      correctAnswer: body.correctAnswer,
      figureCode: body.figureCode,
    });
  }

  /** Lane D4 (S4): soft-removes an `approved` question — never a draft. */
  @Patch(":id/archive")
  async archive(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id") id: string,
  ): Promise<{ id: string; status: "archived" }> {
    return this.service.archiveQuestion(user, id);
  }

  /** Lane D4 (S5): permanently deletes an own `draft` question. */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeDraft(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id") id: string,
  ): Promise<void> {
    await this.service.deleteDraftQuestion(user, id);
  }
}
