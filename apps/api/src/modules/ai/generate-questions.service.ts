import { randomUUID } from "node:crypto";
import { Difficulty } from "@exams-generator/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { BankRepository } from "../bank/bank.repository";
import { PDF_COMPILER_PORT } from "../bank/bank.constants";
import { GradeLevel } from "../exams/domain/value-objects/grade-level";
import { PdfCompilerPort, TypstCompilationError } from "../exams/domain/ports/pdf-compiler.port";
import { correctAnswerLetterToIndex } from "./domain/correct-answer-letter-to-index";
import { GeneratedQuestion, QuestionGeneratorPort } from "./domain/ports/question-generator.port";
import {
  GenerateQuestionsInput,
  validateGenerateQuestionsInput,
} from "./domain/validate-generate-questions-input";
import { QUESTION_GENERATOR_PORT } from "./ai.constants";

/**
 * Max total generate→compile attempts per question when the Typst compile
 * step fails. The model occasionally emits Typst that doesn't compile — a
 * single bad compile shouldn't waste the whole request slot, so we
 * regenerate (fresh call to `QuestionGeneratorPort.generate()`) and
 * recompile before giving up. Only non-compile errors (rate limit, invalid
 * AI response) skip this retry and fail immediately — see
 * `generateQuestions()` below.
 */
const MAX_COMPILE_ATTEMPTS = 2;

export type GenerateQuestionsDto = GenerateQuestionsInput;

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
 *
 * A Typst compile failure alone does NOT immediately fail the item: the
 * service regenerates and recompiles up to `MAX_COMPILE_ATTEMPTS` times
 * (models occasionally emit Typst that doesn't compile) before giving up.
 * Non-compile errors (AI rate limit, invalid AI response, unexpected
 * persistence errors) are NOT retried — they fail the item immediately.
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
        let generated: GeneratedQuestion | undefined;
        let lastCompileError: TypstCompilationError | undefined;

        for (let attempt = 1; attempt <= MAX_COMPILE_ATTEMPTS; attempt += 1) {
          generated = await this.generator.generate({
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
            lastCompileError = undefined;
            break;
          } catch (compileError) {
            if (compileError instanceof TypstCompilationError) {
              lastCompileError = compileError;
              // Bounded retry: regenerate (fresh AI call) and recompile,
              // up to MAX_COMPILE_ATTEMPTS total. Non-compile errors are
              // NOT retried here — they're re-thrown and handled by the
              // outer catch below.
              continue;
            }
            throw compileError;
          }
        }

        if (lastCompileError) {
          failed.push({
            index,
            error: `Typst compile failed: ${lastCompileError.message}`,
          });
          continue;
        }

        const question = generated as GeneratedQuestion;
        const { id } = await this.bankRepository.createStructuredQuestion({
          tenantId: user.tenantId,
          topicId,
          difficulty,
          gradeLevel,
          bodyTypst: question.bodyTypst,
          alternatives: question.alternatives,
          correctAnswer: correctAnswerLetterToIndex(question.correctAnswer),
          figureCode: question.figureCode,
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
