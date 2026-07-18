import { Module } from "@nestjs/common";
import { QUESTION_GENERATOR_PORT } from "./ai.constants";
import { resolveQuestionGeneratorAdapter } from "./ai-provider";

/**
 * Provides `QuestionGeneratorPort` (bound to `OpenRouterAdapter`) for other
 * modules to inject. NOTE: this module intentionally has no
 * controller/endpoint yet — the HTTP endpoint and draft→approve workflow
 * that consume this port are implemented separately (see design doc §5.2).
 */
@Module({
  providers: [{ provide: QUESTION_GENERATOR_PORT, useFactory: resolveQuestionGeneratorAdapter }],
  exports: [QUESTION_GENERATOR_PORT],
})
export class AiModule {}
