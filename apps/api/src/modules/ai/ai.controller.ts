import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { AiExtractedQuestion, AiQuestionCrop, AiRevisedQuestion } from "@exams-generator/shared";
import {
  AccountThrottlerGuard,
  AI_CROP_PER_ACCOUNT_THROTTLE,
  AI_PER_ACCOUNT_THROTTLE,
} from "../../common/account-throttler.guard";
import { Response } from "express";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { NormalizedBox } from "./domain/normalized-box";
import { ExtractQuestionService } from "./extract-question.service";
import { GenerateQuestionsService, GenerateQuestionStreamEvent } from "./generate-questions.service";
import {
  AiGenerationError,
  AiInvalidResponseError,
  AiRateLimitError,
} from "./domain/ports/question-generator.port";
import { RecropQuestionService } from "./recrop-question.service";
import { ReviseQuestionService } from "./revise-question.service";

interface GenerateQuestionsBody {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: string;
  readonly gradeLevel?: string;
  readonly count?: number;
  readonly withFigure?: boolean;
}

interface ReviseQuestionBody {
  readonly instruction?: string;
}

/**
 * Not a `class-validator` DTO like the rest of this module's request bodies
 * (none of them are — see `main.ts`'s `ValidationPipe` docstring): the real
 * validation is `isValidNormalizedBox` inside `RecropQuestionService.recrop`,
 * which rejects a box outside the 0..1 canvas with 400.
 */
interface RecropQuestionBody {
  readonly box: NormalizedBox;
}

/**
 * Maps the domain-layer AI provider errors (plain `Error`s, not HTTP-aware)
 * to the HTTP status the caller can act on. Left uncaught, Nest's default
 * filter turns ALL of them into an identical generic 500, hiding whether the
 * real cause was a rate-limited provider, a garbage AI response, or
 * something else. Anything that is NOT an AI provider error (including the
 * services' own `HttpException`s — 400/404/422) is rethrown unchanged.
 */
function mapAiProviderError(error: unknown): never {
  if (error instanceof AiRateLimitError) {
    throw new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS);
  }
  if (error instanceof AiInvalidResponseError) {
    throw new UnprocessableEntityException(error.message);
  }
  if (error instanceof AiGenerationError) {
    throw new HttpException(error.message, HttpStatus.BAD_GATEWAY);
  }
  throw error;
}

// Same reasoning as bank.controller.ts's MAX_IMAGE_UPLOAD_BYTES — this
// endpoint extracts a question from a photo, never bulk data.
const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

@Controller("ai/questions")
// Order matters: `AccountThrottlerGuard` reads `request.user`, which only
// exists after `JwtAuthGuard` has verified the token. Guards run in the order
// they are listed (audit 2026-08-20, M9).
@UseGuards(JwtAuthGuard, AccountThrottlerGuard)
@Throttle(AI_PER_ACCOUNT_THROTTLE)
export class AiController {
  constructor(
    private readonly service: GenerateQuestionsService,
    private readonly reviseService: ReviseQuestionService,
    private readonly extractService: ExtractQuestionService,
    private readonly recropService: RecropQuestionService,
  ) {}

  /**
   * `POST /ai/questions/generate/stream` — single-question generation
   * streamed live as it happens (design: live streaming progress; batch
   * generation goes through the durable `POST /ai/questions/jobs` flow
   * instead — there is no buffered generate endpoint on this controller).
   * Hand-rolled SSE via `@Res()` rather than
   * Nest's `@Sse()` decorator: `@Sse()` is GET-oriented, and a native
   * browser `EventSource` can't send the `Authorization` header this
   * endpoint's `JwtAuthGuard` requires — the Angular client instead
   * consumes this over `HttpClient` (which the existing auth interceptor
   * already attaches the header to), reading the SSE-shaped body as plain
   * text. Never throws past this point: every failure (validation,
   * not-found taxonomy, AI/compile error) is carried inside a `done` event's
   * `result.failed` instead of an HTTP error status.
   */
  @Post("generate/stream")
  @HttpCode(200)
  async generateStream(
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: GenerateQuestionsBody,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const writeEvent = (event: GenerateQuestionStreamEvent): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const subscription = this.service
      .generateQuestionStream(user, {
        courseId: body.courseId,
        topicId: body.topicId,
        difficulty: body.difficulty,
        gradeLevel: body.gradeLevel,
        withFigure: body.withFigure,
      })
      .subscribe({
        next: writeEvent,
        error: () => {
          writeEvent({
            type: "done",
            result: { created: [], failed: [{ index: 0, error: "Unexpected server error" }] },
          });
          res.end();
        },
        complete: () => res.end(),
      });

    res.on("close", () => subscription.unsubscribe());
  }

  /**
   * `POST /ai/questions/:id/revise` (question editing, Task 4): AI-assisted
   * edit of an EXISTING bank question. Always 200 (not 201) — nothing is
   * created, the response is a revised-but-unsaved draft the caller may
   * later persist via the existing edit endpoint.
   */
  @Post(":id/revise")
  @HttpCode(200)
  async revise(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id") id: string,
    @Body() body: ReviseQuestionBody,
  ): Promise<AiRevisedQuestion> {
    try {
      return await this.reviseService.revise(user, id, body.instruction ?? "");
    } catch (error) {
      mapAiProviderError(error);
    }
  }

  /**
   * `POST /ai/questions/extract` (question editing, Task 5): OCR/vision
   * extraction of a question from a photo. Always 200 (not 201) — nothing is
   * created, the response is a brand-new, unsaved draft the caller may later
   * persist via the existing bank creation endpoints. No `:id` — unlike
   * `revise`, there is no existing question to look up.
   */
  @Post("extract")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES } }))
  async extract(
    @CurrentUser() user: AuthTokenPayload,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<AiExtractedQuestion> {
    if (!file) {
      throw new BadRequestException("file is required");
    }
    try {
      return await this.extractService.extract(user, { buffer: file.buffer, mimetype: file.mimetype });
    } catch (error) {
      mapAiProviderError(error);
    }
  }

  /**
   * `POST /ai/questions/extract/:extractionId/crop` — re-cuts one crop with a
   * box the teacher drew. 200, never 201: nothing is created, and the photo it
   * reads was cached by the extraction call, not by this one.
   */
  @Post("extract/:extractionId/crop")
  @HttpCode(200)
  @Throttle(AI_CROP_PER_ACCOUNT_THROTTLE)
  async recrop(
    @CurrentUser() user: AuthTokenPayload,
    @Param("extractionId", ParseUUIDPipe) extractionId: string,
    @Body() body: RecropQuestionBody,
  ): Promise<AiQuestionCrop> {
    return this.recropService.recrop(user, extractionId, body.box);
  }
}
