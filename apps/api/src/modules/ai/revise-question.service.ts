import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { BankRepository } from "../bank/bank.repository";
import { PDF_COMPILER_PORT } from "../bank/bank.constants";
import { compilePreviewFromContent } from "../bank/domain/compile-preview-from-content";
import { validateStructuredContent } from "../bank/domain/validate-structured-content";
import { PdfCompilerPort, TypstCompilationError } from "../exams/domain/ports/pdf-compiler.port";
import { GeneratedQuestion, QuestionGeneratorPort } from "./domain/ports/question-generator.port";
import { QUESTION_GENERATOR_PORT } from "./ai.constants";

/**
 * The `POST /ai/questions/:id/revise` use case (question editing, Task 4):
 * applies a human-authored instruction ("hazla más difícil") to an EXISTING
 * bank question via `QuestionGeneratorPort.reviseQuestion` and returns a
 * revised, VALIDATED draft — WITHOUT ever persisting it. Approving the
 * revision is a separate, explicit human step (the existing edit/approve
 * flow in `BankService`) — this service never writes to the DB, mirroring
 * the design doc §7 rule that AI output is never saved unvalidated (here:
 * never saved at all, validated or not).
 *
 * Validation is two-layered, same as `GenerateQuestionsService` /
 * `BankService.editQuestion`:
 *   1. `validateStructuredContent` — shape (bodyTypst present, >=2
 *      non-blank alternatives, correctAnswer a valid index).
 *   2. A Typst PREVIEW compile via `compilePreviewFromContent` — the SAME
 *      shared helper `BankService.previewQuestion` uses, so a manual edit
 *      and an AI revision are held to identical compile scrutiny.
 * Either failure surfaces as 422 (Unprocessable Entity) — the AI produced
 * content, it just isn't usable content.
 */
@Injectable()
export class ReviseQuestionService {
  constructor(
    @Inject(QUESTION_GENERATOR_PORT) private readonly generator: QuestionGeneratorPort,
    @Inject(PDF_COMPILER_PORT) private readonly pdfCompiler: PdfCompilerPort,
    private readonly bankRepository: BankRepository,
  ) {}

  async revise(user: AuthTokenPayload, id: string, instruction: string): Promise<GeneratedQuestion> {
    if (!instruction || instruction.trim() === "") {
      throw new BadRequestException("instruction must not be blank");
    }

    const question = await this.bankRepository.findQuestionById(id, user.tenantId);
    if (!question) {
      throw new NotFoundException(`Question not found: ${id}`);
    }

    const revised = await this.generator.reviseQuestion({
      current: {
        bodyTypst: question.bodyTypst ?? "",
        alternatives: (question.alternatives as string[]) ?? [],
        correctAnswer: question.correctAnswer,
      },
      instruction,
      difficulty: question.difficulty,
    });

    const errors = validateStructuredContent({
      bodyTypst: revised.bodyTypst,
      alternatives: revised.alternatives,
      correctAnswer: revised.correctAnswer,
    });
    if (errors.length > 0) {
      throw new UnprocessableEntityException({ message: "AI produced invalid content", errors });
    }

    // Compile-guard, same as manual structured edits — reject non-compiling markup.
    await this.compileOrThrow(id, revised);

    return revised;
  }

  private async compileOrThrow(id: string, revised: GeneratedQuestion): Promise<void> {
    try {
      await compilePreviewFromContent(
        this.pdfCompiler,
        id,
        revised.bodyTypst,
        revised.alternatives,
        revised.figureCode,
      );
    } catch (error) {
      if (error instanceof TypstCompilationError) {
        throw new UnprocessableEntityException("AI produced content that does not compile");
      }
      throw error;
    }
  }
}
