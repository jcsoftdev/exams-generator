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
import { assertStructuredQuestion } from "../bank/domain/assert-structured-question";
import { compilePreviewFromContent } from "../bank/domain/compile-preview-from-content";
import { validateStructuredContent } from "../bank/domain/validate-structured-content";
import { PdfCompilerPort, TypstCompilationError } from "../exams/domain/ports/pdf-compiler.port";
import { GeneratedQuestion, QuestionGeneratorPort } from "./domain/ports/question-generator.port";
import { QUESTION_GENERATOR_PORT } from "./ai.constants";
import { correctAnswerIndexToLetter } from "./domain/correct-answer-index-to-letter";
import { correctAnswerLetterToIndex } from "./domain/correct-answer-letter-to-index";

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
 * `correctAnswer` is a LETTER ("a".."e") on the `QuestionGeneratorPort`
 * contract but a 0-based INDEX in bank storage/the PATCH edit contract —
 * this service converts both directions (`correctAnswerIndexToLetter` /
 * `correctAnswerLetterToIndex`, mirroring `GenerateQuestionsService`) so
 * neither the generator nor `validateStructuredContent` ever see the wrong
 * representation.
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
/**
 * Ceiling on the free-text instruction a teacher sends with a revision (audit
 * 2026-08-20, H6). It is pasted straight into the prompt, and until now the
 * only limit was the 5mb request body — an accidental paste of a whole
 * document would have been billed as input tokens.
 *
 * 2 000 characters is far more than a real instruction ("hazla más difícil",
 * "cambia el contexto a uno agrícola") and still bounds the prompt.
 */
export const MAX_INSTRUCTION_CHARS = 2000;

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
    if (instruction.length > MAX_INSTRUCTION_CHARS) {
      throw new BadRequestException(
        `instruction must be at most ${MAX_INSTRUCTION_CHARS} characters (received ${instruction.length})`,
      );
    }

    const question = await this.bankRepository.findQuestionById(id, user.tenantId);
    if (!question) {
      throw new NotFoundException(`Question not found: ${id}`);
    }

    // IMAGE questions store their clave as a LETTER and carry no
    // bodyTypst/alternatives — there is no structured content for the AI to
    // revise (and `correctAnswerIndexToLetter` would NaN-throw on the letter
    // anyway). Reject up front via the same shared gate `previewQuestion`
    // uses, so this invariant lives in one place, not two.
    assertStructuredQuestion(question, "Question revision");

    const revised = await this.generator.reviseQuestion({
      current: {
        // `assertStructuredQuestion` above already narrows this to a
        // non-empty string — no `?? ""` fallback needed.
        bodyTypst: question.bodyTypst,
        alternatives: (question.alternatives as string[]) ?? [],
        // Bank storage holds a 0-based INDEX, but the port contract expects
        // a LETTER (matches `GeneratedQuestion.correctAnswer`).
        correctAnswer: correctAnswerIndexToLetter(question.correctAnswer),
      },
      instruction,
      difficulty: question.difficulty,
    });

    // The generator returns a LETTER; convert back to the 0-based INDEX
    // bank storage/PATCH convention expects BEFORE validating or returning.
    const revisedWithIndex: GeneratedQuestion = {
      ...revised,
      correctAnswer: correctAnswerLetterToIndex(revised.correctAnswer),
    };

    const errors = validateStructuredContent({
      bodyTypst: revisedWithIndex.bodyTypst,
      alternatives: revisedWithIndex.alternatives,
      correctAnswer: revisedWithIndex.correctAnswer,
    });
    if (errors.length > 0) {
      throw new UnprocessableEntityException({ message: "AI produced invalid content", errors });
    }

    // Compile-guard, same as manual structured edits — reject non-compiling markup.
    await this.compileOrThrow(id, revisedWithIndex);

    return revisedWithIndex;
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
