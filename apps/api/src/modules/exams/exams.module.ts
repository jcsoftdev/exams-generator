import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { db, DRIZZLE_DB } from "../../db/client";
import { PDF_COMPILER_PORT, STORAGE_PORT } from "../bank/bank.constants";
import { resolvePdfCompilerAdapter } from "../bank/pdf-compiler-provider";
import { resolveStorageAdapter } from "../bank/storage-provider";
import { ExamVersionGenerationService } from "./exam-generation.service";
import { ExamVersionJobEventsService } from "./exam-version-job-events.service";
import { ExamVersionJobsProcessor } from "./exam-version-jobs.processor";
import { ExamVersionJobsRepository } from "./exam-version-jobs.repository";
import { ExamVersionJobsService } from "./exam-version-jobs.service";
import { ExamsController } from "./exams.controller";
import { ExamsRepository } from "./exams.repository";
import { ExamsService } from "./exams.service";

/**
 * The `exam-versions` queue moves PDF compilation off the request path
 * (audit P0). Its connection/defaults come from the app-wide `QueueModule`
 * (`common/queue.module.ts`), which is global — this module only declares
 * the queue it owns.
 */
@Module({
  imports: [BullModule.registerQueue({ name: "exam-versions" })],
  controllers: [ExamsController],
  providers: [
    { provide: DRIZZLE_DB, useValue: db },
    ExamsRepository,
    ExamsService,
    ExamVersionGenerationService,
    ExamVersionJobsRepository,
    ExamVersionJobsService,
    ExamVersionJobsProcessor,
    ExamVersionJobEventsService,
    // Both ports bind the SAME tokens the bank module owns/exports (see
    // bank.constants.ts) — one token per capability, never a second
    // module-local Symbol for the same underlying adapter.
    { provide: STORAGE_PORT, useFactory: resolveStorageAdapter },
    { provide: PDF_COMPILER_PORT, useFactory: resolvePdfCompilerAdapter },
  ],
  exports: [ExamsRepository],
})
export class ExamsModule {}
