import { Difficulty } from "@exams-generator/shared";
import {
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
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { QuestionStatus } from "../../db/schema/enums";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { BankService } from "./bank.service";
import { BankTopicQuestionCount, QuestionListItem } from "./bank.repository";
import { clampPagination } from "../../common/pagination.util";

// Question images only, never bulk data — 5MB is generous headroom for a
// scanned/photographed exam question while keeping the in-memory multer
// storage (`FileInterceptor` default) from being a memory-exhaustion vector.
const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * `GET /bank/questions` with no `page` query param — same cap as
 * `clampPagination`'s upper bound (100), just applied even when the caller
 * never asked for pagination at all. See `listQuestions`'s doc comment.
 */
const DEFAULT_UNPAGED_WINDOW = { page: 1, pageSize: 100 };

interface CreateImageQuestionBody {
  readonly courseId?: string;
  readonly topicId?: string;
  /** Optional fine-grained classification under `topicId` (canonical topic taxonomy). */
  readonly subtopicId?: string;
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
  /** sha256 (hex) of the complement image attached right after creation. */
  readonly figureFingerprint?: string;
}

/**
 * `courseId` is intentionally not accepted here — `questions` has no
 * `course_id` column; course is derived by joining `topics.course_id`
 * through `topicId`. To move a question to a different course, PATCH its
 * `topicId` to a topic under that course instead.
 */
interface EditDraftQuestionBody {
  readonly bodyTypst?: string;
  readonly alternatives?: readonly string[];
  readonly correctAnswer?: string;
  readonly figureCode?: string;
  readonly topicId?: string;
  readonly difficulty?: string;
  readonly gradeLevel?: string;
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
  @UseInterceptors(FileInterceptor("image", { limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES } }))
  async createImageQuestion(
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: CreateImageQuestionBody,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ id: string }> {
    return this.service.createImageQuestion(user, {
      courseId: body.courseId,
      topicId: body.topicId,
      subtopicId: body.subtopicId,
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
      figureFingerprint: body.figureFingerprint,
    });
  }

  /**
   * S6: optional pagination, retro-compat SHAPE only — the response is
   * still a bare array when `page` is omitted (existing callers of that
   * form, e.g. a stray script/curl, keep decoding an array). `?page=&
   * pageSize=` switches to `{ items, total }`, clamped the same way
   * `ExamsController.listExams` (T2) clamps its own page/pageSize.
   *
   * The ROW COUNT is no longer retro-compat, though (docs/audit-2026-08-14.md,
   * "GET /bank/questions sin page sigue sin tope"): omitting `page` used to
   * call the unpaginated repository overload and hand back every matching
   * row — no LIMIT at all, the exact shape of the P0 that made `/app/bank`
   * download 41MB. Both web callers that genuinely needed the full
   * flat-array shape (`AiReviewQueueComponent`, `GenerationJobDetailComponent`)
   * are now paginated for real (`AiService.listDraftsPaged`/`getDraftById`,
   * see ai.service.ts) — `DEFAULT_UNPAGED_WINDOW` is pure insurance so no
   * future caller can trigger an unbounded scan again, not a live requirement.
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
      const { items } = await this.service.listQuestions(user, filters, DEFAULT_UNPAGED_WINDOW);
      return items;
    }

    return this.service.listQuestions(user, filters, clampPagination(query.page, query.pageSize));
  }

  /**
   * Per-topic question counts — the skeleton the web bank tree loads instead
   * of the full question list. Same filters as `GET /bank/questions`, same
   * tenant visibility, but the response carries only
   * `{courseId, topicId, total}` rows: the tree renders Curso -> Tema with
   * real counts, and a topic's questions are fetched (paginated) only when
   * that topic is expanded. `/app/bank` used to build the same tree from the
   * unpaginated list, which meant downloading the whole 64k-row central bank
   * on every load.
   *
   * Declared BEFORE `@Get(":id")` — a static-looking route must be
   * registered before the generic `:id` catch-all in the same file for
   * Nest's route matching to prefer it (same reason as `:id/preview`).
   */
  @Get("summary")
  async questionSummary(
    @CurrentUser() user: AuthTokenPayload,
    @Query() query: ListQuestionsQueryParams,
  ): Promise<BankTopicQuestionCount[]> {
    return this.service.countQuestionsByTopic(user, {
      courseId: query.courseId,
      topicId: query.topicId,
      difficulty: query.difficulty as Difficulty | undefined,
      gradeLevel: query.gradeLevel,
      status: query.status as QuestionStatus | undefined,
    });
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
    @Param("id", ParseUUIDPipe) id: string,
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
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<QuestionListItem> {
    return this.service.getQuestionById(user, id);
  }

  /** Lane D3: human curation — draft -> approved. */
  @Post(":id/approve")
  async approveQuestion(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    return this.service.approveQuestion(user, id);
  }

  /** Lane D3: human curation — rejects (deletes) a draft. */
  @Post(":id/reject")
  async rejectQuestion(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    return this.service.rejectQuestion(user, id);
  }

  /**
   * Lane D3 + question editing: human edit of a question's structured
   * content and/or taxonomy — a `draft` (before approval) or an already
   * `approved` question (post-approval correction). Recompiles the Typst
   * preview server-side; a broken edit is rejected with 400 and never
   * persisted. 409 if the question is `archived`.
   */
  @Patch(":id")
  async editDraftQuestion(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: EditDraftQuestionBody,
  ): Promise<QuestionListItem> {
    return this.service.editQuestion(user, id, {
      bodyTypst: body.bodyTypst,
      alternatives: body.alternatives,
      correctAnswer: body.correctAnswer,
      figureCode: body.figureCode,
      topicId: body.topicId,
      difficulty: body.difficulty,
      gradeLevel: body.gradeLevel,
    });
  }

  /**
   * Task 2 (question editing): swaps a question's backing image asset.
   * Works for `type='image'` (the whole question) AND `type='structured'`
   * (an optional complement image — see `bank.service.ts` `replaceImage`).
   * Archived/central-read-only -> 409 (via `requireManageableQuestion`);
   * cross-tenant -> 404. Mirrors `POST /bank/questions/image`'s
   * `FileInterceptor` usage, but the field name here is `file` (this
   * endpoint has no other multipart fields to disambiguate from, unlike
   * creation's `image` alongside taxonomy fields).
   */
  @Post(":id/image")
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES } }))
  async replaceImage(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ id: string }> {
    return this.service.replaceImage(user, id, file);
  }

  /**
   * Attaches one image per alternative slot of a `type='structured'`
   * question — `images[i]` becomes the image for `alternatives[i]`, so
   * `files.length` must exactly match the question's `alternatives.length`
   * (validated in `BankService.setAlternativeImages`, 400 otherwise). Same
   * 404/403/409 gate as `POST :id/image`. `8` = `ALTERNATIVE_LETTERS.length`
   * (the printable-letter ceiling, `typst-template.ts`) — the max alternatives
   * a structured question can realistically have.
   */
  @Post(":id/alternative-images")
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FilesInterceptor("images", 8, { limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES } }))
  async setAlternativeImages(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ): Promise<{ id: string }> {
    return this.service.setAlternativeImages(user, id, files ?? []);
  }

  /** Lane D4 (S4): soft-removes an `approved` question — never a draft. */
  @Patch(":id/archive")
  async archive(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ id: string; status: "archived" }> {
    return this.service.archiveQuestion(user, id);
  }

  /** Lane D4 (S5): permanently deletes an own `draft` question. */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeDraft(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.deleteDraftQuestion(user, id);
  }
}
