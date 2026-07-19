import { Inject, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { validateStructuredContent } from "../bank/domain/validate-structured-content";
import { GeneratedQuestion, QuestionGeneratorPort } from "./domain/ports/question-generator.port";
import { QUESTION_GENERATOR_PORT } from "./ai.constants";
import { correctAnswerLetterToIndex } from "./domain/correct-answer-letter-to-index";

/** Raw multipart file shape this service needs — decoupled from Express/Multer types. */
export interface ExtractQuestionFile {
  readonly buffer: Buffer;
  readonly mimetype: string;
}

/**
 * The `POST /ai/questions/extract` use case (question editing, Task 5): OCR/vision
 * extraction of a question from a photo via `QuestionGeneratorPort.extractFromImage`
 * and returns a VALIDATED draft — WITHOUT ever persisting it. Unlike
 * `ReviseQuestionService` there is no existing `:id`/DB read: this endpoint always
 * produces a brand-new, unsaved draft the caller may later persist via the existing
 * bank creation endpoints.
 *
 * `correctAnswer` is a LETTER ("a".."e") on the `QuestionGeneratorPort` contract but
 * a 0-based INDEX in bank storage/the PATCH edit contract — this service converts the
 * generator's LETTER output to an INDEX (`correctAnswerLetterToIndex`, mirroring
 * `ReviseQuestionService`/`GenerateQuestionsService`) BEFORE validating or returning
 * it, so neither `validateStructuredContent` nor the HTTP caller ever see the letter
 * representation.
 */
@Injectable()
export class ExtractQuestionService {
  constructor(@Inject(QUESTION_GENERATOR_PORT) private readonly generator: QuestionGeneratorPort) {}

  async extract(file: ExtractQuestionFile): Promise<GeneratedQuestion> {
    const extracted = await this.generator.extractFromImage({
      image: file.buffer,
      mimeType: file.mimetype,
    });

    // The generator returns a LETTER; convert to the 0-based INDEX bank
    // storage/PATCH convention expects BEFORE validating or returning.
    const extractedWithIndex: GeneratedQuestion = {
      ...extracted,
      correctAnswer: correctAnswerLetterToIndex(extracted.correctAnswer),
    };

    const errors = validateStructuredContent({
      bodyTypst: extractedWithIndex.bodyTypst,
      alternatives: extractedWithIndex.alternatives,
      correctAnswer: extractedWithIndex.correctAnswer,
    });
    if (errors.length > 0) {
      throw new UnprocessableEntityException({ message: "AI produced invalid content", errors });
    }

    return extractedWithIndex;
  }
}
