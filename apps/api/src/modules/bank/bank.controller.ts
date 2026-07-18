import { Difficulty } from "@exams-generator/shared";
import { Body, Controller, Get, Post, Query, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { BankService } from "./bank.service";
import { QuestionListItem } from "./bank.repository";

interface CreateImageQuestionBody {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: string;
  readonly gradeLevel?: string;
  readonly correctAnswer?: string;
}

interface ListQuestionsQueryParams {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: string;
  readonly gradeLevel?: string;
}

/**
 * `POST /bank/questions/image` and `GET /bank/questions` — the Fase 1 (MVP)
 * bank endpoints. `type = 'structured'` CRUD is Fase 2, out of scope here
 * (see design doc §9).
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

  @Get()
  async listQuestions(
    @CurrentUser() user: AuthTokenPayload,
    @Query() query: ListQuestionsQueryParams,
  ): Promise<QuestionListItem[]> {
    return this.service.listQuestions(user, {
      courseId: query.courseId,
      topicId: query.topicId,
      difficulty: query.difficulty as Difficulty | undefined,
      gradeLevel: query.gradeLevel,
    });
  }
}
