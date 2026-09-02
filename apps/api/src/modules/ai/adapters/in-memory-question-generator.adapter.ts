import { randomUUID } from "node:crypto";
import {
  ExtractedQuestion,
  ExtractQuestionInput,
  GenerateProgressEvent,
  GenerateQuestionInput,
  GeneratedAlternatives,
  GeneratedQuestion,
  QuestionGeneratorPort,
  ReviseQuestionInput,
} from "../domain/ports/question-generator.port";

/** Deterministic padding used when `current.alternatives` has fewer than 5 entries. */
const PADDING_ALTERNATIVES = ["1", "2", "3", "4", "5"];

/**
 * In-process fake for `QuestionGeneratorPort`. Satisfies the exact same
 * contract test as the real OpenRouter adapter — useful for fast
 * unit-level coverage of any code that depends on the port without ever
 * touching the network (mirrors `InMemoryStorageAdapter`).
 */
export class InMemoryQuestionGeneratorAdapter implements QuestionGeneratorPort {
  async generate(
    input: GenerateQuestionInput,
    onProgress?: (event: GenerateProgressEvent) => void,
    _previousCompileError?: string,
  ): Promise<GeneratedQuestion> {
    // The real OpenRouter adapter never produces byte-identical output twice
    // (model sampling temperature); this fake was deterministic per topic,
    // which made repeated `generate()` calls for the same topic collide
    // against BankService's dedupe check (same bodyTypst -> same tenant ->
    // 409) as if they were re-submissions of one already-created question.
    // The random suffix (invisible in Typst — it's inside a comment) keeps
    // every call's content unique, matching real-world variance.
    const question: GeneratedQuestion = {
      bodyTypst: `¿Cuál es el resultado de la operación sobre ${input.topic}? $ 1/2 + 1/4 $ // ${randomUUID()}`,
      alternatives: ["1/4", "3/4", "1/2", "1", "2"],
      correctAnswer: "b",
      figureCode: input.withFigure
        ? `#cetz.canvas({ import cetz.draw: *; circle((0,0), radius: 1) })`
        : undefined,
    };
    onProgress?.({ type: "delta", text: question.bodyTypst });
    return question;
  }

  async reviseQuestion(input: ReviseQuestionInput): Promise<GeneratedQuestion> {
    const padded = [...input.current.alternatives];
    let paddingIndex = 0;
    while (padded.length < 5) {
      padded.push(PADDING_ALTERNATIVES[paddingIndex % PADDING_ALTERNATIVES.length]);
      paddingIndex += 1;
    }

    return {
      bodyTypst: `${input.current.bodyTypst} (revisado: ${input.instruction})`,
      alternatives: padded.slice(0, 5) as unknown as GeneratedAlternatives,
      correctAnswer: input.current.correctAnswer,
    };
  }

  async extractFromImage(_input: ExtractQuestionInput): Promise<ExtractedQuestion> {
    return {
      bodyTypst: "¿Cuánto es $2 + 2$? (extraída de imagen)",
      alternatives: ["3", "4", "5", "6", "7"],
      correctAnswer: "a",
    };
  }
}
