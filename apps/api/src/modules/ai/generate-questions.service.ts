import { randomUUID } from "node:crypto";
import { Difficulty } from "@exams-generator/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { BankRepository } from "../bank/bank.repository";
import { PDF_COMPILER_PORT } from "../bank/bank.constants";
import { GradeLevel } from "../exams/domain/value-objects/grade-level";
import { PdfCompilerPort, TypstCompilationError } from "../exams/domain/ports/pdf-compiler.port";
import { correctAnswerLetterToIndex } from "./domain/correct-answer-letter-to-index";
import { QuestionGeneratorPort } from "./domain/ports/question-generator.port";
import {
  GenerateQuestionsInput,
  validateGenerateQuestionsInput,
} from "./domain/validate-generate-questions-input";
import { QUESTION_GENERATOR_PORT } from "./ai.constants";

export interface GenerateQuestionsDto extends GenerateQuestionsInput {}

export interface GenerateQuestionsCreatedItem {
  readonly id: string;
}

export interface GenerateQuestionsFailedItem {
  readonly index: number;
  readonly error: string;
}

export interface GenerateQuestionsResult {
  readonly created: readonly GenerateQuestionsCreatedItem[];
  readonly failed: readonly GenerateQuestionsFailedItem[];
}

/**
 * The `POST /ai/questions/generate` use case (design doc §5.2). Per
 * question requested:
 *   1. Call `QuestionGeneratorPort.generate()` (already schema-validated by
 *      the adapter itself).
 *   2. Compile a Typst PREVIEW of the generated content via
 *      `PdfCompilerPort` BEFORE persisting — invalid Typst markup (a
 *      malformed `bodyTypst`/`figureCode`) is caught here, not at exam-PDF
 *      time later.
 *   3. Persist as `status='draft'`, `aiGenerated=true` — the AI NEVER
 *      publishes directly to the bank (design doc §7).
 *
 * Failures (either the AI call OR the compile step) are captured PER ITEM,
 * not fatal to the whole batch — one bad generation doesn't waste the
 * others, and the caller gets a clear per-question error to act on.
 */
@Injectable()
export class GenerateQuestionsService {
  constructor(
    @Inject(QUESTION_GENERATOR_PORT) private readonly generator: QuestionGeneratorPort,
    @Inject(PDF_COMPILER_PORT) private readonly pdfCompiler: PdfCompilerPort,
    private readonly bankRepository: BankRepository,
  ) {}

  async generateQuestions(
    user: AuthTokenPayload,
    dto: GenerateQuestionsDto,
  ): Promise<GenerateQuestionsResult> {
    const validation = validateGenerateQuestionsInput(dto);
    if (!validation.ok) {
      throw new BadRequestException(validation.errors);
    }

    const courseId = dto.courseId as string;
    const topicId = dto.topicId as string;
    const difficulty = dto.difficulty as Difficulty;
    const gradeLevel = dto.gradeLevel as GradeLevel;
    const count = dto.count as number;
    const withFigure = dto.withFigure ?? false;

    const taxonomy = await this.bankRepository.findCourseAndTopicNames(courseId, topicId);
    if (!taxonomy) {
      throw new NotFoundException(
        `courseId/topicId not found, or topicId does not belong to courseId`,
      );
    }

    const created: GenerateQuestionsCreatedItem[] = [];
    const failed: GenerateQuestionsFailedItem[] = [];

    for (let index = 0; index < count; index += 1) {
      try {
        const generated = await this.generator.generate({
          course: taxonomy.courseName,
          topic: taxonomy.topicName,
          difficulty,
          gradeLevel,
          withFigure,
        });

        try {
          await this.pdfCompiler.compileExam({
            title: "AI generation preview",
            versionLabel: "preview",
            questions: [
              {
                id: randomUUID(),
                type: "structured",
                bodyTypst: generated.bodyTypst,
                alternatives: generated.alternatives,
                figureCode: generated.figureCode,
              },
            ],
          });
        } catch (compileError) {
          if (compileError instanceof TypstCompilationError) {
            failed.push({ index, error: `Typst compile failed: ${compileError.message}` });
            continue;
          }
          throw compileError;
        }

        const { id } = await this.bankRepository.createStructuredQuestion({
          tenantId: user.tenantId,
          topicId,
          difficulty,
          gradeLevel,
          bodyTypst: generated.bodyTypst,
          alternatives: generated.alternatives,
          correctAnswer: correctAnswerLetterToIndex(generated.correctAnswer),
          figureCode: generated.figureCode,
          createdBy: user.sub,
          status: "draft",
          aiGenerated: true,
        });
        created.push({ id });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ index, error: message });
      }
    }

    return { created, failed };
  }
}
