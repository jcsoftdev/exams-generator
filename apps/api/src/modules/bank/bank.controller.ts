import { Difficulty } from "@exams-generator/shared";
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
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

interface ListQuestionsQueryParams {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: string;
  readonly gradeLevel?: string;
}

/**
 * `POST /bank/questions/image`, `POST /bank/questions/structured` and
 * `GET /bank/questions` — manual bank curation endpoints. Both creation
 * routes persist directly to `status = 'approved'` (curated by definition,
 * design doc §5.1); the AI-generated `status = 'draft'` review flow is a
 * separate lane, out of scope here.
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
}
