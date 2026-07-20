import { randomUUID } from "node:crypto";
import { Difficulty } from "@exams-generator/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Observable } from "rxjs";
import { AuthTokenPayload } from "../auth/token.service";
import { BankRepository } from "../bank/bank.repository";
import { PDF_COMPILER_PORT } from "../bank/bank.constants";
import { GradeLevel } from "../exams/domain/value-objects/grade-level";
import { PdfCompilerPort, TypstCompilationError } from "../exams/domain/ports/pdf-compiler.port";
import { correctAnswerLetterToIndex } from "./domain/correct-answer-letter-to-index";
import { GeneratedQuestion, GenerateProgressEvent, QuestionGeneratorPort } from "./domain/ports/question-generator.port";
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

/** Every event `generateQuestionStream()` can emit — mirrors `GenerateProgressEvent` plus a terminal `done` carrying the same `GenerateQuestionsResult` shape `generateQuestions()` resolves with. */
export type GenerateQuestionStreamEvent =
  | GenerateProgressEvent
  | { readonly type: "done"; readonly result: GenerateQuestionsResult };

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
      const outcome = await this.generateOneItem(user, {
        topicId,
        courseName: taxonomy.courseName,
        topicName: taxonomy.topicName,
        difficulty,
        gradeLevel,
        withFigure,
      });
      if (outcome.ok) {
        created.push({ id: outcome.id });
      } else {
        failed.push({ index, error: outcome.error });
      }
    }

    return { created, failed };
  }

  /**
   * Single-question streaming variant of `generateQuestions()` (design:
   * live progress). `dto` never carries `count` — the frontend already
   * calls the buffered endpoint with `count: 1` in a loop for exactly this
   * reason (see `AiGenerateComponent.generateOne`); this method formalizes
   * "one question, streamed" as its own contract instead of reusing the
   * batch shape. Reuses `generateOneItem()` — same generate→compile-retry→
   * persist pipeline as the batch path, byte for byte.
   */
  generateQuestionStream(
    user: AuthTokenPayload,
    dto: Omit<GenerateQuestionsDto, "count">,
  ): Observable<GenerateQuestionStreamEvent> {
    return new Observable<GenerateQuestionStreamEvent>((subscriber) => {
      let cancelled = false;

      void (async () => {
        try {
          const validation = validateGenerateQuestionsInput({ ...dto, count: 1 });
          if (!validation.ok) {
            subscriber.next({
              type: "done",
              result: { created: [], failed: [{ index: 0, error: validation.errors.join("; ") }] },
            });
            subscriber.complete();
            return;
          }

          const courseId = dto.courseId as string;
          const topicId = dto.topicId as string;
          const difficulty = dto.difficulty as Difficulty;
          const gradeLevel = dto.gradeLevel as GradeLevel;
          const withFigure = dto.withFigure ?? false;

          const taxonomy = await this.bankRepository.findCourseAndTopicNames(courseId, topicId);
          if (cancelled) return;
          if (!taxonomy) {
            subscriber.next({
              type: "done",
              result: {
                created: [],
                failed: [{ index: 0, error: "courseId/topicId not found, or topicId does not belong to courseId" }],
              },
            });
            subscriber.complete();
            return;
          }

          const outcome = await this.generateOneItem(
            user,
            { topicId, courseName: taxonomy.courseName, topicName: taxonomy.topicName, difficulty, gradeLevel, withFigure },
            (event) => {
              if (!cancelled) subscriber.next(event);
            },
          );
          if (cancelled) return;

          subscriber.next({
            type: "done",
            result: outcome.ok
              ? { created: [{ id: outcome.id }], failed: [] }
              : { created: [], failed: [{ index: 0, error: outcome.error }] },
          });
          subscriber.complete();
        } catch (error) {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          subscriber.next({
            type: "done",
            result: { created: [], failed: [{ index: 0, error: message }] },
          });
          subscriber.complete();
        }
      })();

      return () => {
        cancelled = true;
      };
    });
  }

  /**
   * One requested question, end to end: generate → (retry-compile up to
   * `MAX_COMPILE_ATTEMPTS`) → persist as a `draft`. Shared by the batch loop
   * above and `generateQuestionStream()` (streaming, single-item) — the
   * ONLY difference between the two callers is whether `onProgress` is
   * passed through to `QuestionGeneratorPort.generate()`.
   */
  private async generateOneItem(
    user: AuthTokenPayload,
    params: {
      readonly topicId: string;
      readonly courseName: string;
      readonly topicName: string;
      readonly difficulty: Difficulty;
      readonly gradeLevel: GradeLevel;
      readonly withFigure: boolean;
    },
    onProgress?: (event: GenerateProgressEvent) => void,
  ): Promise<{ readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: string }> {
    try {
      let generated: GeneratedQuestion | undefined;
      let lastCompileError: TypstCompilationError | undefined;

      for (let attempt = 1; attempt <= MAX_COMPILE_ATTEMPTS; attempt += 1) {
        if (attempt > 1) {
          onProgress?.({ type: "restart" });
        }
        if (onProgress) {
          generated = await this.generator.generate(
            {
              course: params.courseName,
              topic: params.topicName,
              difficulty: params.difficulty,
              gradeLevel: params.gradeLevel,
              withFigure: params.withFigure,
            },
            onProgress,
          );
        } else {
          generated = await this.generator.generate({
            course: params.courseName,
            topic: params.topicName,
            difficulty: params.difficulty,
            gradeLevel: params.gradeLevel,
            withFigure: params.withFigure,
          });
        }

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
            continue;
          }
          throw compileError;
        }
      }

      if (lastCompileError) {
        return { ok: false, error: `Typst compile failed: ${lastCompileError.message}` };
      }

      const question = generated as GeneratedQuestion;
      const { id } = await this.bankRepository.createStructuredQuestion({
        tenantId: user.tenantId,
        topicId: params.topicId,
        difficulty: params.difficulty,
        gradeLevel: params.gradeLevel,
        bodyTypst: question.bodyTypst,
        alternatives: question.alternatives,
        correctAnswer: correctAnswerLetterToIndex(question.correctAnswer),
        figureCode: question.figureCode,
        createdBy: user.sub,
        status: "draft",
        aiGenerated: true,
      });
      return { ok: true, id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  }
}
