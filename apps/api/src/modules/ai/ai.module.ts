import { Module } from "@nestjs/common";
import { BankModule } from "../bank/bank.module";
import { LazyQuestionGeneratorAdapter } from "./adapters/lazy-question-generator.adapter";
import { AiController } from "./ai.controller";
import { QUESTION_GENERATOR_PORT } from "./ai.constants";
import { resolveQuestionGeneratorAdapter } from "./ai-provider";
import { ExtractQuestionService } from "./extract-question.service";
import { GenerateQuestionsService } from "./generate-questions.service";
import { ReviseQuestionService } from "./revise-question.service";

/**
 * Provides `QuestionGeneratorPort` (bound to `OpenRouterAdapter`, wrapped in
 * `LazyQuestionGeneratorAdapter`) plus the `POST /ai/questions/generate`
 * draft-generation endpoint (design doc §5.2). Imports `BankModule` to
 * reuse its `BankRepository` (persistence) and `PDF_COMPILER_PORT` (Typst
 * preview compile) — the AI generation flow persists into the SAME
 * `questions` table the bank module owns, just always at `status='draft'`.
 *
 * The `QUESTION_GENERATOR_PORT` factory below constructs the lazy wrapper
 * WITHOUT calling `resolveQuestionGeneratorAdapter()` — Nest instantiates
 * every provider eagerly at bootstrap, and that resolver throws when
 * `AI_MODEL`/`OPENROUTER_API_KEY` are unset, which would otherwise crash
 * every app bootstrap (including e2e tests) the moment this module is
 * imported into `AppModule`.
 */
@Module({
  imports: [BankModule],
  controllers: [AiController],
  providers: [
    GenerateQuestionsService,
    ReviseQuestionService,
    ExtractQuestionService,
    {
      provide: QUESTION_GENERATOR_PORT,
      useFactory: () => new LazyQuestionGeneratorAdapter(resolveQuestionGeneratorAdapter),
    },
  ],
  exports: [QUESTION_GENERATOR_PORT],
})
export class AiModule {}
