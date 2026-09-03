import { Module } from "@nestjs/common";
import { db, DRIZZLE_DB } from "../../db/client";
import { BankController } from "./bank.controller";
import { PDF_COMPILER_PORT, STORAGE_PORT } from "./bank.constants";
import { resolvePdfCompilerAdapter } from "./pdf-compiler-provider";
import { BankRepository } from "./bank.repository";
import { BankService } from "./bank.service";
import { resolveStorageAdapter } from "./storage-provider";
import { BankFoldersController } from "./folders/bank-folders.controller";
import { BankFoldersRepository } from "./folders/bank-folders.repository";
import { BankFoldersService } from "./folders/bank-folders.service";

/**
 * `BankRepository` and `PDF_COMPILER_PORT` are exported so the `ai` module
 * can reuse the SAME persistence + Typst-preview-compile pieces for the AI
 * draft-generation flow (Lane D3, design doc §5.2) instead of duplicating
 * them — mirrors how `exams.module.ts` reuses `STORAGE_PORT` from here.
 * `BankFoldersService` is exported the same way — `BankService` will inject
 * it once question create/update needs to validate a `folderId`.
 */
@Module({
  controllers: [BankController, BankFoldersController],
  providers: [
    { provide: DRIZZLE_DB, useValue: db },
    BankService,
    BankRepository,
    BankFoldersService,
    BankFoldersRepository,
    { provide: STORAGE_PORT, useFactory: resolveStorageAdapter },
    { provide: PDF_COMPILER_PORT, useFactory: resolvePdfCompilerAdapter },
  ],
  exports: [BankRepository, BankFoldersService, PDF_COMPILER_PORT],
})
export class BankModule {}
