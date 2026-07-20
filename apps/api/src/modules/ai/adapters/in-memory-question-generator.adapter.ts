import {
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
  ): Promise<GeneratedQuestion> {
    const question: GeneratedQuestion = {
      bodyTypst: `¿Cuál es el resultado de la operación sobre ${input.topic}? $ 1/2 + 1/4 $`,
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

  async extractFromImage(_input: ExtractQuestionInput): Promise<GeneratedQuestion> {
    return {
      bodyTypst: "¿Cuánto es $2 + 2$? (extraída de imagen)",
      alternatives: ["3", "4", "5", "6", "7"],
      correctAnswer: "a",
    };
  }
}
