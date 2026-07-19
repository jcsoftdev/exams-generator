import { Module } from "@nestjs/common";
import { STORAGE_PORT } from "../bank/bank.constants";
import { resolveStorageAdapter } from "../bank/storage-provider";
import { ExamVersionGenerationService } from "./exam-generation.service";
import { ExamsController } from "./exams.controller";
import { PDF_COMPILER_PORT } from "./exams.constants";
import { ExamsRepository } from "./exams.repository";
import { ExamsService } from "./exams.service";
import { resolvePdfCompilerAdapter } from "./pdf-compiler-provider";

@Module({
  controllers: [ExamsController],
  providers: [
    ExamsRepository,
    ExamsService,
    ExamVersionGenerationService,
    { provide: STORAGE_PORT, useFactory: resolveStorageAdapter },
    { provide: PDF_COMPILER_PORT, useFactory: resolvePdfCompilerAdapter },
  ],
  exports: [ExamsRepository],
})
export class ExamsModule {}
