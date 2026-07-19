import { Body, Controller, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { GenerateQuestionsResult, GenerateQuestionsService } from "./generate-questions.service";
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

/**
 * `POST /ai/questions/generate` (design doc §5.2): generates up to `count`
 * AI questions for a course/topic/difficulty/gradeLevel, compiling a Typst
 * preview of each BEFORE persisting it. Every persisted question lands as
 * `status='draft'` — review/approve/reject/edit is the bank module's
 * `POST :id/approve` / `POST :id/reject` / `PATCH :id` (Lane D3). Returns a
 * per-item result (`created`/`failed`) rather than failing the whole
 * request on one bad item.
 */
@Controller("ai/questions")
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private readonly service: GenerateQuestionsService,
    private readonly reviseService: ReviseQuestionService,
  ) {}

  @Post("generate")
  async generate(
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: GenerateQuestionsBody,
  ): Promise<GenerateQuestionsResult> {
    return this.service.generateQuestions(user, {
      courseId: body.courseId,
      topicId: body.topicId,
      difficulty: body.difficulty,
      gradeLevel: body.gradeLevel,
      count: body.count,
      withFigure: body.withFigure,
    });
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
}
