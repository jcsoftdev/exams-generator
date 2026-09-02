import { Logger, Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { BankModule } from "../bank/bank.module";
import { LazyQuestionGeneratorAdapter } from "./adapters/lazy-question-generator.adapter";
import { resolveAiProviderConfig } from "./resolve-ai-provider-config";
import { SharpImageCropperAdapter } from "./adapters/image/sharp-image-cropper.adapter";
import { RedisExtractionCacheAdapter } from "./adapters/cache/redis-extraction-cache.adapter";
import { AiController } from "./ai.controller";
import { AiJobsController } from "./ai-jobs.controller";
import {
  EXTRACTION_CACHE_PORT,
  IMAGE_CROPPER_PORT,
  QUESTION_GENERATOR_PORT,
  TEXT_REGION_DETECTOR_PORT,
} from "./ai.constants";
import { TesseractCliAdapter } from "./adapters/ocr/tesseract-cli.adapter";
import { resolveQuestionGeneratorAdapter } from "./ai-provider";
import { GenerationJobEventsService } from "./generation-job-events.service";
import { GenerationJobsProcessor } from "./generation-jobs.processor";
import { GenerationJobsRepository } from "./generation-jobs.repository";
import { GenerationJobsService } from "./generation-jobs.service";
import { ExtractQuestionService } from "./extract-question.service";
import { GenerateQuestionsService } from "./generate-questions.service";
import { RecropQuestionService } from "./recrop-question.service";
import { ReviseQuestionService } from "./revise-question.service";

/**
 * Provides `QuestionGeneratorPort`, the draft-generation/revise/extract
 * endpoints, and the durable `generation` BullMQ queue (design doc:
 * docs/superpowers/specs/2026-07-19-ai-generation-history-design.md). See
 * `ai.module.ts`'s original docstring for why `QUESTION_GENERATOR_PORT` is
 * built lazily.
 *
 * The shared BullMQ connection/defaults used to be declared here via
 * `BullModule.forRoot`; they now live in `QueueModule` (`common/queue.module.ts`)
 * so `ExamsModule`'s `exam-versions` queue doesn't implicitly depend on this
 * module being imported.
 */
@Module({
  imports: [BankModule, BullModule.registerQueue({ name: "generation" })],
  controllers: [AiController, AiJobsController],
  providers: [
    GenerateQuestionsService,
    ReviseQuestionService,
    ExtractQuestionService,
    RecropQuestionService,
    GenerationJobsRepository,
    GenerationJobsService,
    GenerationJobsProcessor,
    GenerationJobEventsService,
    {
      provide: QUESTION_GENERATOR_PORT,
      useFactory: () => {
        // Advisory only — never blocks boot. `LazyQuestionGeneratorAdapter`
        // below defers the SAME check to first use (that's what keeps a
        // missing AI_MODEL/AI_API_KEY — or a bad AI_THINKING/AI_RESPONSE_FORMAT,
        // both of which `resolveAiProviderConfig` now also raises as
        // `AiNotConfiguredError` — from crashing every app bootstrap, e2e
        // included); this WARN just gives an operator a chance to notice the
        // gap in the boot log before a teacher hits the 503 it produces.
        // Logs EVERY caught error, not just `AiNotConfiguredError` — an
        // instanceof gate here would silently swallow anything
        // `resolveAiProviderConfig` starts throwing that this code doesn't
        // yet know about, leaving the exact same "silent at boot, 500 at
        // request time" gap this check exists to close.
        try {
          resolveAiProviderConfig(process.env);
        } catch (error) {
          new Logger("AiModule").warn(
            `AI provider is not configured — every AI endpoint will return 503 until this is fixed: ${(error as Error).message}`,
          );
        }
        return new LazyQuestionGeneratorAdapter(resolveQuestionGeneratorAdapter);
      },
    },
    { provide: IMAGE_CROPPER_PORT, useClass: SharpImageCropperAdapter },
    { provide: EXTRACTION_CACHE_PORT, useClass: RedisExtractionCacheAdapter },
    { provide: TEXT_REGION_DETECTOR_PORT, useClass: TesseractCliAdapter },
  ],
  exports: [QUESTION_GENERATOR_PORT, GenerationJobsRepository, GenerationJobsService],
})
export class AiModule {}
