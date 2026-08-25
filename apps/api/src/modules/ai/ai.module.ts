import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { BankModule } from "../bank/bank.module";
import { LazyQuestionGeneratorAdapter } from "./adapters/lazy-question-generator.adapter";
import { SharpImageCropperAdapter } from "./adapters/image/sharp-image-cropper.adapter";
import { AiController } from "./ai.controller";
import { AiJobsController } from "./ai-jobs.controller";
import { IMAGE_CROPPER_PORT, QUESTION_GENERATOR_PORT } from "./ai.constants";
import { resolveQuestionGeneratorAdapter } from "./ai-provider";
import { GenerationJobEventsService } from "./generation-job-events.service";
import { GenerationJobsProcessor } from "./generation-jobs.processor";
import { GenerationJobsRepository } from "./generation-jobs.repository";
import { GenerationJobsService } from "./generation-jobs.service";
import { ExtractQuestionService } from "./extract-question.service";
import { GenerateQuestionsService } from "./generate-questions.service";
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
    GenerationJobsRepository,
    GenerationJobsService,
    GenerationJobsProcessor,
    GenerationJobEventsService,
    {
      provide: QUESTION_GENERATOR_PORT,
      useFactory: () => new LazyQuestionGeneratorAdapter(resolveQuestionGeneratorAdapter),
    },
    { provide: IMAGE_CROPPER_PORT, useClass: SharpImageCropperAdapter },
  ],
  exports: [QUESTION_GENERATOR_PORT, GenerationJobsRepository, GenerationJobsService],
})
export class AiModule {}
