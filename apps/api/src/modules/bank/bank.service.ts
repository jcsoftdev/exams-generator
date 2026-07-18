import { randomUUID } from "node:crypto";
import { Difficulty } from "@exams-generator/shared";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { StoragePort } from "../exams/domain/ports/storage.port";
import { STORAGE_PORT } from "./bank.constants";
import { BankRepository, QuestionListItem } from "./bank.repository";
import { validateCreateImageQuestionInput } from "./domain/validate-create-image-question";

export interface CreateImageQuestionDto {
  readonly courseId: string | undefined;
  readonly topicId: string | undefined;
  readonly difficulty: string | undefined;
  readonly gradeLevel: string | undefined;
  readonly correctAnswer: string | undefined;
  readonly file: Express.Multer.File | undefined;
}

export interface ListQuestionsQuery {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly gradeLevel?: string;
}

/**
 * Orchestrates the manual image-question upload flow (design doc 5.1) and
 * tenant-scoped listing. Validation happens BEFORE the storage upload so a
 * rejected request never leaves an orphaned object in MinIO.
 */
@Injectable()
export class BankService {
  constructor(
    private readonly repository: BankRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  async createImageQuestion(
    user: AuthTokenPayload,
    dto: CreateImageQuestionDto,
  ): Promise<{ id: string }> {
    const validation = validateCreateImageQuestionInput({
      courseId: dto.courseId,
      topicId: dto.topicId,
      difficulty: dto.difficulty,
      gradeLevel: dto.gradeLevel,
      correctAnswer: dto.correctAnswer,
      hasImage: Boolean(dto.file),
    });

    if (!validation.ok) {
      throw new BadRequestException(validation.errors);
    }

    const file = dto.file as Express.Multer.File;
    const storageKey = `bank/questions/${randomUUID()}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);

    return this.repository.createImageQuestion({
      tenantId: user.tenantId,
      topicId: dto.topicId as string,
      difficulty: dto.difficulty as Difficulty,
      gradeLevel: dto.gradeLevel as string,
      correctAnswer: dto.correctAnswer as string,
      createdBy: user.sub,
      image: { storageKey, mime: file.mimetype },
    });
  }

  async listQuestions(
    user: AuthTokenPayload,
    query: ListQuestionsQuery,
  ): Promise<QuestionListItem[]> {
    return this.repository.listQuestions({
      currentTenantId: user.tenantId,
      courseId: query.courseId,
      topicId: query.topicId,
      difficulty: query.difficulty,
      gradeLevel: query.gradeLevel,
    });
  }
}
