import {
  GenerateQuestionInput,
  GeneratedQuestion,
  QuestionGeneratorPort,
} from "../domain/ports/question-generator.port";

/**
 * In-process fake for `QuestionGeneratorPort`. Satisfies the exact same
 * contract test as the real OpenRouter adapter — useful for fast
 * unit-level coverage of any code that depends on the port without ever
 * touching the network (mirrors `InMemoryStorageAdapter`).
 */
export class InMemoryQuestionGeneratorAdapter implements QuestionGeneratorPort {
  async generate(input: GenerateQuestionInput): Promise<GeneratedQuestion> {
    return {
      bodyTypst: `¿Cuál es el resultado de la operación sobre ${input.topic}? $ 1/2 + 1/4 $`,
      alternatives: ["1/4", "3/4", "1/2", "1", "2"],
      correctAnswer: "b",
      figureCode: input.withFigure
        ? `#cetz.canvas({ import cetz.draw: *; circle((0,0), radius: 1) })`
        : undefined,
    };
  }
}
