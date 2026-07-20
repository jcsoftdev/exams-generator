import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { ExtractQuestionService } from "./extract-question.service";
import { GenerateQuestionsService, GenerateQuestionStreamEvent } from "./generate-questions.service";
import { GeneratedQuestion } from "./domain/ports/question-generator.port";
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

@Controller("ai/questions")
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private readonly service: GenerateQuestionsService,
    private readonly reviseService: ReviseQuestionService,
    private readonly extractService: ExtractQuestionService,
  ) {}

  /**
   * `POST /ai/questions/generate/stream` — same single-question generation
   * as `generate()` with `count: 1`, but streamed live as it happens (design:
   * live streaming progress). Hand-rolled SSE via `@Res()` rather than
   * Nest's `@Sse()` decorator: `@Sse()` is GET-oriented, and a native
   * browser `EventSource` can't send the `Authorization` header this
   * endpoint's `JwtAuthGuard` requires — the Angular client instead
   * consumes this over `HttpClient` (which the existing auth interceptor
   * already attaches the header to), reading the SSE-shaped body as plain
   * text. Never throws past this point: every failure (validation,
   * not-found taxonomy, AI/compile error) is carried inside a `done` event's
   * `result.failed`, exactly like the buffered endpoint above.
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
  ): Promise<GeneratedQuestion> {
    return this.reviseService.revise(user, id, body.instruction ?? "");
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
  @UseInterceptors(FileInterceptor("file"))
  async extract(@UploadedFile() file: Express.Multer.File): Promise<GeneratedQuestion> {
    if (!file) {
      throw new BadRequestException("file is required");
    }
    return this.extractService.extract({ buffer: file.buffer, mimetype: file.mimetype });
  }
}
