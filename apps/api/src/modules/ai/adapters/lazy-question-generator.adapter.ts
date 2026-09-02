import {
  ExtractedQuestion,
  ExtractQuestionInput,
  GenerateProgressEvent,
  GenerateQuestionInput,
  GeneratedQuestion,
  QuestionGeneratorPort,
  ReviseQuestionInput,
} from "../domain/ports/question-generator.port";

/**
 * Wraps a `QuestionGeneratorPort` resolver (e.g.
 * `resolveQuestionGeneratorAdapter`) WITHOUT invoking it. NestJS instantiates
 * every provider eagerly at bootstrap, and `resolveQuestionGeneratorAdapter`
 * throws when `AI_MODEL`/`OPENROUTER_API_KEY` are missing — if `AiModule`'s
 * factory called it directly, importing `AiModule` into `AppModule` would
 * crash EVERY app bootstrap (including e2e tests) that doesn't set those
 * envs. This adapter defers resolution to the first `generate()` call and
 * caches the result, so the real adapter (and its env validation) is only
 * ever touched when generation is actually used.
 */
export class LazyQuestionGeneratorAdapter implements QuestionGeneratorPort {
  private resolved: QuestionGeneratorPort | undefined;

  constructor(private readonly resolve: () => QuestionGeneratorPort) {}

  async generate(
    input: GenerateQuestionInput,
    onProgress?: (event: GenerateProgressEvent) => void,
    previousCompileError?: string,
  ): Promise<GeneratedQuestion> {
    if (!this.resolved) {
      this.resolved = this.resolve();
    }
    return this.resolved.generate(input, onProgress, previousCompileError);
  }

  async reviseQuestion(input: ReviseQuestionInput): Promise<GeneratedQuestion> {
    if (!this.resolved) {
      this.resolved = this.resolve();
    }
    return this.resolved.reviseQuestion(input);
  }

  async extractFromImage(input: ExtractQuestionInput): Promise<ExtractedQuestion> {
    if (!this.resolved) {
      this.resolved = this.resolve();
    }
    return this.resolved.extractFromImage(input);
  }
}
