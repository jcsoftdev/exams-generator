import { Module } from "@nestjs/common";
import { PDF_COMPILER_PORT, STORAGE_PORT } from "../bank/bank.constants";
import { resolvePdfCompilerAdapter } from "../bank/pdf-compiler-provider";
import { resolveStorageAdapter } from "../bank/storage-provider";
import { ExamVersionGenerationService } from "./exam-generation.service";
import { ExamsController } from "./exams.controller";
import { ExamsRepository } from "./exams.repository";
import { ExamsService } from "./exams.service";

@Module({
  controllers: [ExamsController],
  providers: [
    ExamsRepository,
    ExamsService,
    ExamVersionGenerationService,
    // Both ports bind the SAME tokens the bank module owns/exports (see
    // bank.constants.ts) — one token per capability, never a second
    // module-local Symbol for the same underlying adapter.
    { provide: STORAGE_PORT, useFactory: resolveStorageAdapter },
    { provide: PDF_COMPILER_PORT, useFactory: resolvePdfCompilerAdapter },
  ],
  exports: [ExamsRepository],
})
export class ExamsModule {}
